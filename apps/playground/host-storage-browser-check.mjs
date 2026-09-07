import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
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
  await call("Page.navigate", { url: target });
  await ready();
  await click("Export task");
  await wait(
    "document.querySelector('textarea[aria-label=\"Snapshot JSON\"]').value.includes('playground-task-v1')",
    "Task export",
  );
  const storageEntry = fileURLToPath(new URL("./src/host/storage.ts", import.meta.url));
  const buildResult = await build({
    entryPoints: [storageEntry],
    bundle: true,
    format: "iife",
    globalName: "HostStorageReview",
    write: false,
    target: "es2022",
  });
  await evaluate(buildResult.outputFiles[0].text);
  const results = await evaluate(String.raw`(async () => {
    const {IndexedDbHostStorage} = HostStorageReview;
    const doc = JSON.parse(document.querySelector('textarea[aria-label="Snapshot JSON"]').value);
    const name = 'host-review-' + crypto.randomUUID();
    const a = new IndexedDbHostStorage(name), b = new IndexedDbHostStorage(name);
    const passed=[];
    const check=(condition,label)=>{if(!condition)throw new Error(label);passed.push(label)};
    const rejects=async (fn,label)=>{let rejected=false;try{await fn()}catch(error){if(error.message==='HUNG_READ')throw error;rejected=true}check(rejected,label)};
    const change = (value) => {const d=structuredClone(doc);d.snapshot.annotations[0].x=value;return d};
    const baseline=structuredClone(doc);
    const saving=a.saveDraft({taskId:'one',expectedTaskVersion:0,document:doc,name:'One'});
    doc.snapshot.annotations[0].x=999;
    const saved=await saving;
    check(saved.taskVersion===1 && saved.draftVersion===1,'Initial save versions');
    const original=await a.getTask('one');
    check(original.draft.document.snapshot.annotations[0].x===baseline.snapshot.annotations[0].x,'Detached capture before asynchronous open');
    doc.snapshot.annotations[0].x=baseline.snapshot.annotations[0].x;
    await rejects(()=>b.saveDraft({taskId:'one',expectedTaskVersion:0,document:change(150)}),'Stale draft CAS rejects');
    const competing=await Promise.allSettled([a.saveDraft({taskId:'one',expectedTaskVersion:1,document:change(150)}),b.saveDraft({taskId:'one',expectedTaskVersion:1,document:change(200)})]);
    check(competing.filter(x=>x.status==='fulfilled').length===1,'Concurrent connections have one CAS winner');
    const accepted=await a.acceptRevision({taskId:'one',expectedTaskVersion:2,operationId:'accept-one',document:change(250)});
    check(accepted.metadata.taskVersion===3 && accepted.metadata.currentDraftVersion===2,'Acceptance advances task version only');
    await a.saveDraft({taskId:'one',expectedTaskVersion:3,document:change(300)});
    const retry=await b.acceptRevision({taskId:'one',expectedTaskVersion:2,operationId:'accept-one',document:change(250)});
    check(retry.revision.revisionId===accepted.revision.revisionId && retry.metadata.taskVersion===4,'Retry returns same revision after version advances');
    const altered=change(250);altered.config+='\n<!-- changed config -->';
    await rejects(()=>b.acceptRevision({taskId:'one',expectedTaskVersion:4,operationId:'accept-one',document:altered}),'Operation cannot reuse different config');
    const alteredImage=change(250);alteredImage.imageUrl=alteredImage.imageUrl.replace('image/svg+xml','image/png');
    await rejects(()=>b.acceptRevision({taskId:'one',expectedTaskVersion:4,operationId:'accept-one',document:alteredImage}),'Operation cannot reuse different image bytes/type');
    accepted.revision.document.snapshot.annotations[0].x=999;
    check((await b.listAcceptedRevisions('one'))[0].document.snapshot.annotations[0].x===250,'Accepted content remains detached and immutable');
    await rejects(()=>b.acceptRevision({taskId:'two',expectedTaskVersion:0,operationId:'accept-one',document:change(250)}),'Operation belongs to original task');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {if(this.name==='drafts')throw new DOMException('Injected quota failure','QuotaExceededError');return put.apply(this,args)};
    try { await rejects(()=>a.saveDraft({taskId:'one',expectedTaskVersion:4,document:change(350)}),'Failed draft write rejects'); }
    finally {IDBObjectStore.prototype.put=put;}
    check((await b.getTask('one')).metadata.taskVersion===4,'Failed draft write rolls back metadata');
    const raw=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const corrupt=async(store,key,mutate)=>new Promise((resolve,reject)=>{const t=raw.transaction(store,'readwrite'),s=t.objectStore(store),r=s.get(key);r.onsuccess=()=>{const value=r.result;mutate(value);s.put(value)};t.oncomplete=resolve;t.onabort=()=>reject(t.error)});
    const originalDraft=(await a.getTask('one')).draft;
    await new Promise((resolve,reject)=>{const t=raw.transaction('drafts','readwrite');t.objectStore('drafts').delete('one');t.oncomplete=resolve;t.onabort=()=>reject(t.error)});
    await rejects(()=>a.getTask('one'),'Missing declared draft rejects');
    await new Promise((resolve,reject)=>{const t=raw.transaction('drafts','readwrite');t.objectStore('drafts').put(originalDraft);t.oncomplete=resolve;t.onabort=()=>reject(t.error)});
    await corrupt('drafts','one',r=>r.document.snapshot.annotations[0].width=-1);
    await rejects(()=>Promise.race([a.getTask('one'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('HUNG_READ')),1500))]),'Corrupt draft read rejects');
    await corrupt('tasks','one',r=>r.schemaVersion=99);
    await rejects(()=>a.listTasks(),'Invalid metadata cannot be listed as valid');
    await rejects(()=>a.saveDraft({taskId:'one',expectedTaskVersion:4,document:change(350)}),'Write refuses corrupt metadata');
    raw.close();a.close();b.close();
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error)});
    const closing=new IndexedDbHostStorage(name+'-closing');
    const opening=closing.listTasks();closing.close();
    const outcome=await Promise.race([opening.then(()=> 'resolved',()=> 'rejected'),new Promise(resolve=>setTimeout(()=>resolve('hung'),1200))]);
    check(outcome==='rejected','Close during open rejects outstanding promise');
    const transient=new HostStorageReview.IndexedDbHostStorage(name+'-transient');
    const originalOpen=indexedDB.open.bind(indexedDB);
    indexedDB.open=()=>{throw new DOMException('temporary denial','SecurityError')};
    await rejects(()=>transient.listTasks(),'Transient opening failure rejects');
    indexedDB.open=originalOpen;
    check((await transient.listTasks()).length===0,'Transient open failure can retry');
    transient.close();
    return passed;
  })()`);
  console.log("PASS: independent actual IndexedDB adapter:", results);
  assert.deepEqual(exceptions, []);
} finally {
  socket?.close();
  sourceServer?.closeAllConnections();
  sourceServer?.close();
  chrome.kill();
  await new Promise((resolve) => (chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve)));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
