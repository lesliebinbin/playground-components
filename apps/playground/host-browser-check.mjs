import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const target = process.env.PROBE_URL || "http://localhost:4201/?component-probe=1";
const profile = await mkdtemp(join(tmpdir(), "component-probe-chrome-"));
const chrome = spawn(
  process.env.CHROME_BIN || "/usr/bin/google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let socket;
let sourceServer;
const exceptions = [];
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chrome did not start")), 15000);
    let text = "";
    chrome.stderr.on("data", (chunk) => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.on("error", reject);
  });
  const port = new URL(endpoint).port;
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      const timer = setTimeout(() => {
        pending.delete(request);
        reject(new Error(`${method} timed out`));
      }, 20000);
      pending.set(request, (message) => {
        clearTimeout(timer);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      });
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  const evaluate = async (expression) => {
    try {
      const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    } catch (error) {
      throw new Error(`Runtime.evaluate failed for ${expression}: ${String(error)}`);
    }
  };
  const wait = async (expression, label, timeout = 45000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`${label}: timed out\n${await evaluate("document.body.innerText")}\n${exceptions.join("\n")}`);
  };
  const click = (name) =>
    evaluate(
      `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(name)}); if (!b || b.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(name)}); b.click(); })()`,
    );
  const snapshot = () => evaluate("JSON.parse(document.querySelector('[data-testid=probe-output]').textContent)");
  const setField = (id, value) =>
    evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  const ready = () =>
    wait(
      "document.querySelectorAll('iframe').length === 1 && !!document.querySelector('iframe[title=\"Annotation editor\"]') && document.body.innerText.includes('Ready to annotate')",
      "Editor readiness",
    );
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: target });
  await ready();
  const textHas = (s) => wait(`document.body.innerText.includes(${JSON.stringify(s)})`, s);
  const move = async () => {
    const x = (await snapshot()).annotations[0].x;
    await click("Move right 50 px");
    await wait(
      `JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations[0].x > ${x + 49}`,
      "move",
    );
  };
  const records = () =>
    evaluate(
      `new Promise((resolve,reject)=>{const r=indexedDB.open('playground-host-v1');r.onsuccess=()=>{const db=r.result;const t=db.transaction(['tasks','drafts','accepted_revisions']);let result={};for(const s of ['tasks','drafts','accepted_revisions']){const q=t.objectStore(s).getAll();q.onsuccess=()=>result[s]=q.result;}t.oncomplete=()=>{db.close();resolve(result)};t.onabort=()=>reject(t.error)}})`,
    );
  await textHas("Never saved");
  await click("Save draft");
  await textHas("Saved draft current");
  const first = await records();
  assert.equal(first.tasks.length, 1);
  const taskId = first.tasks[0].taskId;
  await move();
  await textHas("Unsaved changes");
  await click("Export task");
  await textHas("Unsaved changes");
  await click("Accept revision");
  await textHas("Accepted revision #1");
  await textHas("Unsaved changes");
  const accepted = await records();
  assert.equal(accepted.accepted_revisions.length, 1);
  assert.equal(accepted.drafts[0].document.snapshot.annotations[0].x, 100);
  assert.equal(accepted.accepted_revisions[0].document.snapshot.annotations[0].x, 150);
  await move();
  await click("Save draft");
  await textHas("Saved draft current");
  const saved = await records();
  assert.equal(saved.drafts[0].document.snapshot.annotations[0].x, 200);
  assert.equal(saved.accepted_revisions[0].document.snapshot.annotations[0].x, 150);
  await call("Page.reload");
  await ready();
  await wait("document.querySelector('.probe-host-controls select').options.length === 2", "saved list reload");
  const select = async () =>
    evaluate(
      `(()=>{const el=document.querySelector('.probe-host-controls select');el.value=${JSON.stringify(taskId)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  await select();
  await click("Open saved task");
  await ready();
  await textHas("Saved draft current");
  assert.equal((await snapshot()).annotations[0].x, 200);
  await move();
  await click("Load human fixture");
  await wait("!!document.querySelector('dialog[open]')", "dirty modal");
  await click("Save & replace");
  await ready();
  await textHas("Never saved");
  assert.equal((await records()).drafts[0].document.snapshot.annotations[0].x, 250);
  await move();
  await select();
  await click("Open saved task");
  await wait("!!document.querySelector('dialog[open]')", "restore modal");
  await click("Replace task");
  await ready();
  await textHas("Saved draft current");
  assert.equal((await snapshot()).annotations[0].x, 250);
  // Delay an actual committed transaction's acknowledgement, leaving the editor live.
  await evaluate(`(() => {
    const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
    Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(callback){
      descriptor.set.call(this,function(event){
        const mode=window.__hostFault;
        if(mode && this.mode==='readwrite' && this.objectStoreNames.contains('tasks')) {
          window.__hostFault=null;
          window.__releaseHostWrite=()=> mode==='lost' ? this.onabort?.call(this,new Event('abort')) : callback.call(this,event);
          return;
        }
        callback.call(this,event);
      });
    }});
  })()`);
  await evaluate("window.__hostFault='delay';window.__releaseHostWrite=null");
  await click("Save draft");
  await wait("typeof window.__releaseHostWrite==='function'", "pending save acknowledgement");
  await move();
  await evaluate("window.__releaseHostWrite()");
  await textHas("Unsaved changes");
  assert.equal((await records()).drafts[0].document.snapshot.annotations[0].x, 250);
  await evaluate("window.__hostFault='lost';window.__releaseHostWrite=null");
  await click("Accept revision");
  await wait("typeof window.__releaseHostWrite==='function'", "lost acceptance ack");
  await evaluate("window.__releaseHostWrite()");
  await textHas("Revision acceptance failed");
  const beforeRetry = await records();
  const originalRevision = beforeRetry.accepted_revisions.find((r) => r.revisionNumber === 2);
  assert.equal(originalRevision.document.snapshot.annotations[0].x, 300);
  await move();
  await click("Retry acceptance");
  await textHas("idempotent retry");
  const retried = await records();
  assert.equal(retried.accepted_revisions.length, 2);
  assert.equal((await snapshot()).annotations[0].x, 350);
  await textHas("Unsaved changes");
  // An old task's failed acceptance must not install retry data on its replacement.
  await evaluate("window.__hostFault='lost';window.__releaseHostWrite=null");
  await click("Accept revision");
  await wait("typeof window.__releaseHostWrite==='function'", "old task ack");
  await click("Dispose");
  await click("Load AI fixture");
  await ready();
  await evaluate("window.__releaseHostWrite()");
  await delay(200);
  assert.equal(await evaluate("!!document.querySelector('[role=alert]')"), false);
  assert.equal(
    await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Retry acceptance')"),
    false,
  );
  await textHas("Never saved");
  await evaluate("document.querySelector('iframe').scrollIntoView({block:'center'})");
  const canvas = await evaluate(`(() => {
    const frame = document.querySelector('iframe');
    const doc = frame.contentDocument;
    const label = [...doc.querySelectorAll('span')].find(el => el.textContent.trim() === 'Vehicle');
    if (!label) throw new Error('Vehicle label not found');
    label.click();
    const a = frame.getBoundingClientRect(), b = doc.querySelector('canvas').getBoundingClientRect();
    return {x: a.x + b.x, y: a.y + b.y, width:b.width, height:b.height};
  })()`);
  const start = { x: canvas.x + canvas.width * 0.55, y: canvas.y + canvas.height * 0.5 };
  const end = { x: canvas.x + canvas.width * 0.8, y: canvas.y + canvas.height * 0.75 };
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", clickCount: 1 });
  for (let step = 1; step <= 8; step++) {
    await call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: start.x + ((end.x - start.x) * step) / 8,
      y: start.y + ((end.y - start.y) * step) / 8,
      buttons: 1,
    });
  }
  await click("Save draft");
  await textHas("gesture is currently in progress");
  assert.equal((await records()).tasks.length, 1);
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", clickCount: 1 });
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations.length === 2",
    "finished draw",
  );
  await click("Save draft");
  await textHas("Saved draft current");
  assert.equal((await records()).tasks.length, 2);
  await move();
  await click("Load human fixture");
  await wait("!!document.querySelector('dialog[open]')", "save cancel modal");
  await evaluate(
    "window.__retainedFrame=document.querySelector('iframe');window.__hostFault='delay';window.__releaseHostWrite=null",
  );
  await click("Save & replace");
  await wait("typeof window.__releaseHostWrite==='function'", "save before cancelled replacement");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('dialog[open]')", "Escape dismissed replacement");
  await evaluate("window.__releaseHostWrite()");
  await delay(300);
  assert.equal(await evaluate("document.querySelector('iframe')===window.__retainedFrame"), true);
  await textHas("Saved draft current");
  // A storage quota failure keeps the edited draft live and leaves its durable version unchanged.
  await move();
  const beforeQuota = await records();
  await evaluate(
    `window.__originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('Test quota failure','QuotaExceededError');return window.__originalPut.apply(this,args)}`,
  );
  await click("Save draft");
  await textHas("Test quota failure");
  await textHas("Unsaved changes");
  await evaluate("IDBObjectStore.prototype.put=window.__originalPut");
  assert.deepEqual(await records(), beforeQuota);
  await click("Save draft");
  await textHas("Saved draft current");
  // Accepted-only tasks restore the immutable revision as a never-saved working draft.
  await click("Load AI fixture");
  await ready();
  await click("Accept revision");
  await textHas("Accepted revision #1");
  const acceptedOnly = (await records()).tasks.find((t) => t.currentDraftVersion === 0);
  assert.ok(acceptedOnly);
  await call("Page.reload");
  await ready();
  await wait(
    "document.querySelector('.probe-host-controls select').options.length === 4",
    "accepted-only durable entry",
  );
  await evaluate(
    `(()=>{const el=document.querySelector('.probe-host-controls select');el.value=${JSON.stringify(acceptedOnly.taskId)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await click("Open saved task");
  await ready();
  await textHas("Never saved");
  await click("Save draft");
  await textHas("Saved draft current");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await delay(100);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= 390"), true);
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.scrollTo(0,0)");
  const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(
    process.env.HOST_SCREENSHOT || join(tmpdir(), "host-reviewed.png"),
    Buffer.from(screenshot.data, "base64"),
  );
  assert.deepEqual(exceptions, []);
  console.log(
    "PASS save/edit/export/accept/reload/restore/save-and-replace/confirmed-restore/delayed-save/lost-ack-retry/stale-failure/gesture-completion/cancelled-replacement/quota-rollback/accepted-only-restore",
  );
} finally {
  socket?.close();
  sourceServer?.closeAllConnections();
  sourceServer?.close();
  chrome.kill();
  await new Promise((resolve) => (chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve)));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
