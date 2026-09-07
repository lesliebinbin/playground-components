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
  await call("Page.bringToFront");
  await evaluate("void window.focus()");
  await ready();
  const initial = await snapshot();
  assert.equal(initial.annotations[0].origin, "ai");
  assert.equal(initial.annotations[0].x, 100);
  await click("Move right 50 px");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations[0].x > 149",
    "Move",
  );
  assert.equal((await snapshot()).annotations[0].latestEditor, "human");
  await click("Undo");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations[0].x === 100",
    "Undo",
  );
  assert.deepEqual(await snapshot(), initial);
  await click("Redo");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations[0].x > 149",
    "Redo",
  );
  await evaluate(`(() => {
    const frame = document.querySelector('iframe');
    const annotation = frame.contentWindow.Htx.annotationStore.selected;
    annotation.selectArea([...annotation.areas.values()].find(area => area.cleanId === 'r1'));
    window.__presentationContinuity = {
      element: frame,
      document: frame.contentDocument,
      engine: frame.contentWindow.Htx,
      output: document.querySelector('[data-testid=probe-output]').textContent,
      selectedIds: annotation.selectedRegions.map(region => region.cleanId),
    };
  })()`);
  await wait(
    "document.querySelector('iframe').contentWindow.Htx.annotationStore.selected.selectedRegions.length > 0",
    "Selection setup",
  );
  const activeConfig = await evaluate("document.getElementById('task-config').value");
  await setField("task-config", `${activeConfig}\n<!-- unapplied draft -->`);
  await click("Hide configuration");
  await wait("document.querySelector('#probe-configuration').hidden", "Configuration disclosure close");
  await evaluate(`(() => {
    const button = document.querySelector('[aria-controls=probe-configuration]');
    button.focus();
    return document.hasFocus() && document.activeElement === button;
  })()`);
  assert.equal(
    await evaluate(
      "document.hasFocus() && document.activeElement === document.querySelector('[aria-controls=probe-configuration]')",
    ),
    true,
    "Configuration disclosure must hold document focus",
  );
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    text: "\r",
    unmodifiedText: "\r",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await wait("!document.querySelector('#probe-configuration').hidden", "Configuration disclosure keyboard open");
  assert.equal(
    await evaluate("document.querySelector('[aria-controls=probe-configuration]').getAttribute('aria-expanded')"),
    "true",
  );
  assert.equal(
    await evaluate("document.getElementById('task-config').value.endsWith('<!-- unapplied draft -->')"),
    true,
  );
  await evaluate(`(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__copiedActiveConfig = text; } },
    });
  })()`);
  await click("Copy active XML");
  await wait("document.body.innerText.includes('Active configuration copied.')", "Configuration copy success");
  assert.equal(await evaluate("window.__copiedActiveConfig"), activeConfig);
  const continuity = () =>
    evaluate(`(() => {
      const saved = window.__presentationContinuity;
      const frame = document.querySelector('iframe');
      const annotation = frame.contentWindow.Htx.annotationStore.selected;
      return frame === saved.element &&
        frame.contentDocument === saved.document &&
        frame.contentWindow.Htx === saved.engine &&
        document.querySelector('[data-testid=probe-output]').textContent === saved.output &&
        JSON.stringify(annotation.selectedRegions.map(region => region.cleanId)) === JSON.stringify(saved.selectedIds);
    })()`);
  await click("Hide inspectors");
  await wait("document.querySelector('#probe-inspection').hidden", "Inspector disclosure close");
  assert.equal(
    await evaluate(
      "document.querySelector('[aria-controls=probe-inspection]').getAttribute('aria-expanded') === 'false' && document.querySelector('#probe-inspection').hidden",
    ),
    true,
  );
  assert.equal(await continuity(), true, "Inspector collapse must retain frame continuity");
  await click("Show inspectors");
  await wait("!document.querySelector('#probe-inspection').hidden", "Inspector disclosure open");
  assert.equal(await continuity(), true, "Inspector expansion must retain frame continuity");
  for (const mode of ["Preview", "Preview inline", "Full mode"]) {
    await click(mode);
    await wait(
      `document.querySelector('[aria-label="Display mode"] button[aria-pressed="true"]').textContent === ${JSON.stringify(mode)}`,
      `${mode} commit`,
    );
    assert.equal(
      await continuity(),
      true,
      `${mode} must retain the active frame, document, engine, result, and selection`,
    );
  }
  assert.equal(
    await evaluate("document.getElementById('task-config').value.endsWith('<!-- unapplied draft -->')"),
    true,
    "Draft XML must survive display changes",
  );
  assert.equal(
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Undo').disabled"),
    false,
  );
  await click("Undo");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations[0].x === 100",
    "Undo after presentation changes",
  );
  assert.equal(
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Redo').disabled"),
    false,
  );
  await click("Redo");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations[0].x > 149",
    "Redo after presentation changes",
  );
  await evaluate(`(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('Permission denied'); } },
    });
  })()`);
  await click("Copy active XML");
  await wait(
    "document.querySelector('[role=alert]').textContent.includes('Permission denied')",
    "Configuration copy failure",
  );
  await click("Shell theme: light");
  await wait("!!document.querySelector('.probe-theme-dark')", "Shell dark theme");
  assert.equal(await continuity(), true, "Shell theme must retain frame continuity");
  const darkContrast = await evaluate(`(() => {
    const field = document.getElementById('task-config');
    const paragraph = document.querySelector('.task-fields p');
    const rgb = value => value.match(/\\d+/g).map(Number);
    const luminance = ([r, g, b]) => [r, g, b].map(channel => {
      const normalized = channel / 255;
      return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [0.2126, .7152, .0722][index], 0);
    const contrast = (a, b) => {
      const [lighter, darker] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
      return (lighter + .05) / (darker + .05);
    };
    return {
      field: contrast(getComputedStyle(field).color, getComputedStyle(field).backgroundColor),
      paragraph: contrast(getComputedStyle(paragraph).color, getComputedStyle(document.querySelector('.probe-app')).backgroundColor),
    };
  })()`);
  assert(darkContrast.field >= 4.5, `Dark XML field contrast is too low: ${darkContrast.field}`);
  assert(darkContrast.paragraph >= 4.5, `Dark paragraph contrast is too low: ${darkContrast.paragraph}`);
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 700, deviceScaleFactor: 1, mobile: false });
  await click("Preview inline");
  await wait(
    `document.querySelector('[aria-label="Display mode"] button[aria-pressed="true"]').textContent === "Preview inline"`,
    "Compact mode commit",
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
    true,
    "Compact shell must not overflow",
  );
  await click("Full mode");
  await wait(
    "getComputedStyle(document.querySelector('.probe-full-only')).display !== 'none'",
    "Full mode recoverability",
  );
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__copiedActiveConfig = text; } },
    });
  })()`);
  await click("Copy active XML");
  await wait(
    "!document.querySelector('[role=alert]')?.textContent.includes('Permission denied')",
    "Clipboard error recovery",
  );
  await click("Toggle label");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations[0].label === 'Vehicle'",
    "Relabel",
  );
  await click("Export snapshot");
  await wait("document.querySelector('textarea:not([id])').value.includes('Vehicle')", "Export");
  const exported = await snapshot();
  await click("Load snapshot");
  await ready();
  assert.deepEqual(await snapshot(), exported);
  assert.equal(
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Undo').disabled"),
    true,
  );
  const session = await evaluate("document.querySelector('iframe').src");
  await evaluate(
    `(() => { const el=document.querySelector('textarea:not([id])'); const invalid=JSON.parse(el.value); invalid.annotations[0].width=-1; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,JSON.stringify(invalid)); el.dispatchEvent(new Event('input',{bubbles:true})); })()`,
  );
  await click("Load snapshot");
  await wait(
    "document.querySelector('[role=alert]')?.textContent.includes('Invalid geometry')",
    "Invalid input rejection",
  );
  assert.equal(await evaluate("document.querySelector('iframe').src"), session);
  assert.deepEqual(await snapshot(), exported);
  await click("Load human fixture");
  await ready();
  assert.equal((await snapshot()).annotations[0].origin, "human");
  await click("Load AI fixture");
  await click("Dispose");
  await delay(1000);
  assert.equal(await evaluate("document.querySelectorAll('iframe').length"), 0);
  await click("Load AI fixture");
  await click("Load human fixture");
  await ready();
  assert.equal((await snapshot()).annotations[0].origin, "human");
  assert.equal(await evaluate("!!window.Htx"), false);
  assert.equal(await evaluate("!!document.querySelector('iframe').contentWindow.Htx"), true);
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
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", clickCount: 1 });
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations.length === 2",
    "Pointer rectangle creation",
  );
  const drawn = (await snapshot()).annotations.find((r) => r.id !== "r1");
  assert.equal(drawn.label, "Vehicle");
  assert.equal(drawn.origin, "human");
  await click("Undo");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations.length === 1",
    "Undo pointer drawing",
  );
  await click("Redo");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations.length === 2",
    "Redo pointer drawing",
  );
  assert.deepEqual(
    (await snapshot()).annotations.find((r) => r.id !== "r1"),
    drawn,
  );
  await click("Export snapshot");
  await wait("document.querySelector('textarea:not([id])').value.includes('Vehicle')", "Final export");
  const originalConfig = await evaluate("document.getElementById('task-config').value");
  const beforeInvalidConfig = await evaluate("document.querySelector('iframe').src");
  await setField("task-config", "<View>");
  await click("Apply configuration & image");
  await wait(
    "document.querySelector('[role=alert]')?.textContent.includes('Malformed XML')",
    "Malformed configuration",
  );
  assert.equal(await evaluate("document.querySelector('iframe').src"), beforeInvalidConfig);
  const customConfig = originalConfig
    .replace('name="image"', 'name="photo"')
    .replace('toName="image"', 'toName="photo"')
    .replace('name="label"', 'name="boxes"')
    .replace("$image", "$asset")
    .replace("</RectangleLabels>", '<Label value="Tree" background="#50774a" /></RectangleLabels>');
  await setField("task-config", customConfig);
  await click("Apply configuration & image");
  await ready();
  assert.equal((await snapshot()).annotations.length, 2);
  assert.equal(
    await evaluate("document.querySelector('iframe').contentWindow.Htx.annotationStore.selected.names.has('photo')"),
    true,
  );
  await setField("task-config", customConfig.replace('value="Person"', 'value="Animal"'));
  await click("Apply configuration & image");
  await wait("document.querySelector('[role=alert]')?.textContent.includes('Unsupported label')", "Used-label removal");
  await setField("task-config", customConfig);
  await click("Move right 50 px");
  await wait(
    "JSON.parse(document.querySelector('[data-testid=probe-output]').textContent).annotations.find(r=>r.id==='r1').x > 149",
    "Dirty edit",
  );
  const editedFrame = await evaluate("document.querySelector('iframe').src");
  await click("Load human fixture");
  await wait("!!document.querySelector('dialog[open]')", "Dirty-work disposition");
  const dialogContrast = await evaluate(`(() => {
    const dialog = document.querySelector('dialog[open]');
    const rgb = value => value.match(/\\d+/g).map(Number);
    const luminance = ([r, g, b]) => [r, g, b].map(channel => {
      const normalized = channel / 255;
      return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [0.2126, .7152, .0722][index], 0);
    const [lighter, darker] = [luminance(rgb(getComputedStyle(dialog.querySelector('p')).color)), luminance(rgb(getComputedStyle(dialog).backgroundColor))].sort((a, b) => b - a);
    return (lighter + .05) / (darker + .05);
  })()`);
  assert(dialogContrast >= 4.5, `Dark replacement dialog contrast is too low: ${dialogContrast}`);
  await click("Keep editing");
  assert.equal(await evaluate("document.querySelector('iframe').src"), editedFrame);
  await click("Load human fixture");
  await wait("!!document.querySelector('dialog[open]')", "Dirty-work disposition again");
  await click("Replace task");
  await ready();
  const upload = join(profile, "source.svg");
  await writeFile(
    upload,
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#adc9b5"/></svg>',
  );
  const document = await call("DOM.getDocument");
  const fileNode = await call("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#task-image-file" });
  await call("DOM.setFileInputFiles", { nodeId: fileNode.nodeId, files: [upload] });
  await wait("document.querySelector('.task-fields').textContent.includes('source.svg')", "File read");
  await click("Apply configuration & image");
  await ready();
  assert.equal((await snapshot()).source.width, 640);
  assert.equal((await snapshot()).source.height, 480);
  assert.equal((await snapshot()).annotations.length, 0);
  await click("Export task");
  const taskDocument = await evaluate("JSON.parse(document.querySelector('textarea:not([id])').value)");
  assert.equal(taskDocument.format, "playground-task-v1");
  assert(taskDocument.imageUrl.startsWith("data:image/"));
  const portableTask = JSON.stringify(taskDocument);
  await call("Page.navigate", { url: target });
  await ready();
  await evaluate(
    `(() => {const el=document.querySelector('textarea:not([id])');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(portableTask)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click("Load snapshot");
  await ready();
  assert.equal((await snapshot()).source.width, 640);
  const preservedFrame = await evaluate("document.querySelector('iframe').src");
  await setField("task-image-url", "http://localhost:4201/not-an-image.png");
  await evaluate(
    "(() => {const el=document.getElementById('task-results');el.value='empty';el.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await click("Apply configuration & image");
  await wait("!!document.querySelector('[role=alert]')", "Invalid image rejection");
  assert.equal(await evaluate("document.querySelector('iframe').src"), preservedFrame);
  let requested = false;
  sourceServer = createServer((_req, res) => {
    requested = true;
    setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*" });
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="green"/></svg>',
      );
    }, 1250);
  });
  await new Promise((resolve) => sourceServer.listen(0, "127.0.0.1", resolve));
  await setField("task-image-url", `http://127.0.0.1:${sourceServer.address().port}/slow.svg`);
  await click("Apply configuration & image");
  for (let i = 0; i < 50 && !requested; i++) await delay(50);
  assert(requested, "Delayed image request started");
  await click("Load AI fixture");
  await ready();
  const winningFrame = await evaluate("document.querySelector('iframe').src");
  await delay(1500);
  assert.equal((await snapshot()).source.width, 1000);
  assert.equal(await evaluate("document.querySelector('iframe').src"), winningFrame);
  await writeFile(
    process.env.PROBE_SCREENSHOT || "/tmp/component-probe.png",
    Buffer.from((await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"),
  );
  assert.deepEqual(exceptions, []);
  console.log(
    "PASS: editing/history and lifecycle regression; configurable bindings/labels, invalid XML and label-removal preservation, dirty-work cancel/replace, image upload/dimensions, portable full-task reload, failed-image preservation, and stale image request cancellation; no uncaught browser exceptions.",
  );
} finally {
  socket?.close();
  sourceServer?.closeAllConnections();
  sourceServer?.close();
  chrome.kill();
  await new Promise((resolve) => (chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve)));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
