import React from "react";
import { jest, afterEach, expect } from "@jest/globals";
import "@testing-library/jest-dom";
import { JSDOM } from "jsdom";
import fetchMock from "../../libs/editor/__mocks__/jest-fetch-mock.js";
import { mockFF } from "../../libs/editor/__mocks__/global";

const mock = Object.assign(jest.fn, {
  clearAllMocks: jest.clearAllMocks,
  restoreAllMocks: jest.restoreAllMocks,
  restore: jest.restoreAllMocks,
});
Object.assign(globalThis, {
  mock,
  mockFF,
  spyOn(object, key, accessType) {
    if (!accessType && object[key]?.$$typeof && typeof object[key] !== "function") {
      const component = object[key];
      const replacement = jest.fn((props) => React.createElement(component, props));
      jest.replaceProperty(object, key, replacement);
      return replacement;
    }
    return accessType ? jest.spyOn(object, key, accessType) : jest.spyOn(object, key);
  },
  useFakeTimers: jest.useFakeTimers,
  useRealTimers: jest.useRealTimers,
  advanceTimersByTime: jest.advanceTimersByTime,
  runAllTimers: jest.runAllTimers,
  setSystemTime: jest.setSystemTime,
  clearAllMocks: jest.clearAllMocks,
  resetAllMocks: jest.resetAllMocks,
  restoreAllMocks: jest.restoreAllMocks,
  resetModules: jest.resetModules,
  // Pass the test module's Jest object so relative paths resolve from that file.
  mockModule(runtime, id, factory) {
    if (!factory) return runtime.doMock(id);
    runtime.doMock(id, () => {
      const produced = factory();
      if (!produced || typeof produced !== "object" || Array.isArray(produced)) return produced;
      if (produced.__skipMerge) return produced;
      const actual = runtime.requireActual(id);
      const merged = { ...actual, ...produced };
      if ("default" in produced || actual?.__esModule) merged.__esModule = true;
      return merged;
    });
  },
});

const reactNoisePatterns = [
  /^You are using a whole package of antd/,
  /^Stage not found for area #/,
  /^LSF: annotation accessed before store is initialized/,
  /^Drawing tool model needs to implement .*$/,
  /^MultipleClicksMixin model needs to implement .*$/,
  /^Warning: React does not recognize the `.*` prop on a DOM element\./,
  /^Warning: Function components cannot be given refs\./,
  /^Warning: forwardRef render functions accept exactly two parameters/,
  /^Warning: .*`ref` is not a prop\./,
  /^Warning: <.*> is using incorrect casing\./,
  /^Warning: The tag <.*> is unrecognized in this browser\./,
  /^Warning: Received `.*` for a non-boolean attribute `.*`\./,
  /^Warning: Invalid value for prop `.*` on <.*> tag\./,
  /^Warning: Invalid event handler property `.*`\./,
  /^Warning: Unknown event handler property `.*`\./,
  /^Warning: Cannot update a component \(`.*`\) while rendering a different component \(`.*`\)\./,
  /^Error: Not implemented: window\.computedStyle\(elt, pseudoElt\)/,
  /^Error: Not implemented: navigation \(except hash changes\)/,
];

const shouldSuppressReactNoise = (args: unknown[]) => {
  const [first] = args;
  if (typeof first !== "string") return false;
  return reactNoisePatterns.some((pattern) => pattern.test(first));
};

const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);

console.error = (...args: unknown[]) => {
  if (shouldSuppressReactNoise(args)) return;
  originalConsoleError(...args);
};

console.warn = (...args: unknown[]) => {
  if (shouldSuppressReactNoise(args)) return;
  originalConsoleWarn(...args);
};

if (typeof window === "undefined") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).navigator = dom.window.navigator;
  (globalThis as any).localStorage = dom.window.localStorage;
  (globalThis as any).sessionStorage = dom.window.sessionStorage;
  (globalThis as any).Storage = dom.window.Storage;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Element = dom.window.Element;
  (globalThis as any).HTMLDivElement = dom.window.HTMLDivElement;
  (globalThis as any).HTMLCanvasElement = dom.window.HTMLCanvasElement;
  (globalThis as any).HTMLMediaElement = dom.window.HTMLMediaElement;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  (globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
  (globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).MutationObserver = dom.window.MutationObserver;
}
// Ensure localStorage/sessionStorage always match window's, even if window was already defined
(globalThis as any).localStorage = (window as any).localStorage;
(globalThis as any).sessionStorage = (window as any).sessionStorage;
(globalThis as any).MouseEvent = (window as any).MouseEvent;
(globalThis as any).KeyboardEvent = (window as any).KeyboardEvent;
(globalThis as any).FocusEvent = (window as any).FocusEvent;
(globalThis as any).WheelEvent = (window as any).WheelEvent;
(globalThis as any).SVGElement = (window as any).SVGElement;
(globalThis as any).HTMLIFrameElement = (window as any).HTMLIFrameElement;
(globalThis as any).HTMLInputElement = (window as any).HTMLInputElement;
(globalThis as any).HTMLTextAreaElement = (window as any).HTMLTextAreaElement;
(globalThis as any).HTMLSelectElement = (window as any).HTMLSelectElement;
(globalThis as any).HTMLButtonElement = (window as any).HTMLButtonElement;
(globalThis as any).Option = (window as any).Option;
(globalThis as any).CustomEvent = (window as any).CustomEvent;
(globalThis as any).DOMParser = (window as any).DOMParser;
(globalThis as any).NodeFilter = (window as any).NodeFilter;
(globalThis as any).Range = (window as any).Range;
(globalThis as any).XPathResult = (window as any).XPathResult;
(globalThis as any).Image = (window as any).Image;
(globalThis as any).XMLHttpRequest = (window as any).XMLHttpRequest;
(globalThis as any).MutationObserver = (window as any).MutationObserver;
(globalThis as any).alert = (window as any).alert = mock();
(globalThis as any).confirm = (window as any).confirm = mock(() => true);
(globalThis as any).prompt = (window as any).prompt = mock(() => "");
const _pendingRAFs = new Map<number, ReturnType<typeof setTimeout>>();
let _rafCounter = 0;
const _trackingRAF = (cb: FrameRequestCallback) => {
  const id = ++_rafCounter;
  const timer = setTimeout(() => {
    _pendingRAFs.delete(id);
    cb(performance.now());
  }, 16);
  _pendingRAFs.set(id, timer);
  return id;
};
const _trackingCAF = (id: number) => {
  const timer = _pendingRAFs.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    _pendingRAFs.delete(id);
  }
};
(globalThis as any).requestAnimationFrame = (window as any).requestAnimationFrame = _trackingRAF;
(globalThis as any).cancelAnimationFrame = (window as any).cancelAnimationFrame = _trackingCAF;
(globalThis as any).getComputedStyle = window.getComputedStyle.bind(window);

// React's legacy input-event polyfill can call attachEvent/detachEvent in jsdom.
// Emulate the minimal IE-style propertychange contract via input/change events.
const ensureLegacyInputEventApis = () => {
  const proto = (window as any).HTMLElement?.prototype;
  if (!proto) return;
  if (typeof proto.attachEvent === "function" && typeof proto.detachEvent === "function") return;

  const listeners = new WeakMap<object, Map<Function, EventListener>>();

  if (typeof proto.attachEvent !== "function") {
    proto.attachEvent = function (eventName: string, handler: Function) {
      if (eventName !== "onpropertychange" || typeof handler !== "function") return;

      const wrapped: EventListener = (event) => {
        (event as any).propertyName = "value";
        handler.call(this, event);
      };

      let map = listeners.get(this);
      if (!map) {
        map = new Map();
        listeners.set(this, map);
      }
      map.set(handler, wrapped);

      this.addEventListener("input", wrapped);
      this.addEventListener("change", wrapped);
    };
  }

  if (typeof proto.detachEvent !== "function") {
    proto.detachEvent = function (eventName: string, handler: Function) {
      if (eventName !== "onpropertychange" || typeof handler !== "function") return;

      const wrapped = listeners.get(this)?.get(handler);
      if (!wrapped) return;

      this.removeEventListener("input", wrapped);
      this.removeEventListener("change", wrapped);
      listeners.get(this)?.delete(handler);
    };
  }
};

ensureLegacyInputEventApis();

const _origGetSelection =
  (document as any).getSelection?.bind(document) ?? (window as any).getSelection?.bind(window) ?? (() => null);

const ensureSelectionApis = () => {
  (window as any).getSelection = _origGetSelection;
  (globalThis as any).getSelection = _origGetSelection;
};

ensureSelectionApis();
(window as any).APP_SETTINGS = { ...(window as any).APP_SETTINGS, hostname: "http://localhost" };
(globalThis as any).APP_SETTINGS = (window as any).APP_SETTINGS;

const originalDefineProperty = Object.defineProperty;
Object.defineProperty = function (target: object, property: PropertyKey, descriptor: PropertyDescriptor): any {
  if (
    property === "location" &&
    descriptor &&
    "value" in descriptor &&
    (target as any)?.history &&
    (target as any)?.location
  ) {
    const nextValue = (descriptor as any).value;
    const href = typeof nextValue === "string" ? nextValue : nextValue?.toString?.();
    if (href) {
      try {
        (target as any).history.replaceState({}, "", href);
        return target;
      } catch {
        // fallback to default defineProperty
      }
    }
  }
  return originalDefineProperty(target, property, descriptor);
};

// Keep classic JSX and old libs happy.
(globalThis as any).React = React;
(window as any).React = React;

// Import RTL's /pure build (no auto-cleanup afterEach) and expose it as the
// main "@testing-library/react" module.  We handle cleanup ourselves in our
// afterEach with a try-catch so it can never hang the runner.
const _rtlPure = require("@testing-library/react/pure");
jest.doMock("@testing-library/react", () => _rtlPure);
const _rtlCleanup = _rtlPure.cleanup;
// user-event registers lifecycle hooks; load it before any test executes.
require("@testing-library/user-event");

const createDefaultFetchMock = () => mock(async () => new Response("{}", { status: 200 })) as any;
globalThis.fetch = createDefaultFetchMock();
if (!(globalThis as any).customElements) {
  (globalThis as any).customElements = {
    define: mock(),
    get: mock(() => undefined),
    whenDefined: mock(async () => undefined),
  };
}
// ---------------------------------------------------------------------------
// Centralized MST mock: safe try-catch wrappers prevent per-file
// jest.doMock("mobx-state-tree") from polluting the global module cache.
// Test files that need specific behavior override via .mockImplementation()
// in beforeEach; preload's afterEach resets everything to the safe default.
// ---------------------------------------------------------------------------
const _mst: any = require("mobx-state-tree");
const _mstExports: Record<string, any> = { ..._mst };
const _origGetRoot = _mst.getRoot;
const _origGetEnv = _mst.getEnv;
const _origGetParentOfType = _mst.getParentOfType;
const _origIsAlive = _mst.isAlive;
const _origDestroy = _mst.destroy;
const _origGetType = _mst.getType;

const _safeGetRoot = mock((node: any) => {
  try {
    return _origGetRoot(node);
  } catch {
    return {};
  }
});
const _safeGetEnv = mock((node: any) => {
  try {
    return _origGetEnv(node);
  } catch {
    return {};
  }
});
const _safeGetParentOfType = mock((...args: any[]) => {
  try {
    return _origGetParentOfType(...args);
  } catch {
    return null;
  }
});
const _safeIsAlive = mock((node: any) => {
  try {
    return _origIsAlive(node);
  } catch {
    return true;
  }
});
const _safeDestroy = mock((...args: any[]) => {
  try {
    return _origDestroy(...args);
  } catch {
    /* noop */
  }
});
const _safeGetType = mock((...args: any[]) => {
  try {
    return _origGetType(...args);
  } catch {
    return { name: "Unknown" };
  }
});

(globalThis as any).__mstOriginals = {
  getRoot: _origGetRoot,
  getEnv: _origGetEnv,
  getParentOfType: _origGetParentOfType,
  isAlive: _origIsAlive,
  destroy: _origDestroy,
  getType: _origGetType,
};

jest.doMock("mobx-state-tree", () => ({
  ..._mstExports,
  __esModule: true,
  getRoot: _safeGetRoot,
  getEnv: _safeGetEnv,
  getParentOfType: _safeGetParentOfType,
  isAlive: _safeIsAlive,
  destroy: _safeDestroy,
  getType: _safeGetType,
}));

function _resetMstMock(fn: any, impl: Function) {
  if (typeof fn?.mockReset === "function") fn.mockReset();
  if (typeof fn?.mockImplementation === "function") fn.mockImplementation(impl);
}

jest.doMock("react-konva-utils", () => {
  const React = require("react");
  const Portal = (props: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, props?.children);
  return {
    __esModule: true,
    Portal,
    default: { Portal },
  };
});

jest.doMock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children?: unknown }) => children ?? null,
}));
jest.doMock("rehype-raw", () => ({
  __esModule: true,
  default: () => undefined,
}));

// Konva requires native canvas in node-mode; keep existing test behavior by stubbing.

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

globalThis.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: mock().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: mock(),
    removeListener: mock(),
    addEventListener: mock(),
    removeEventListener: mock(),
    dispatchEvent: mock(),
  })),
});

if (typeof (window as any).Range !== "undefined") {
  const rangeProto = (window as any).Range.prototype;
  if (typeof rangeProto.getBoundingClientRect !== "function") {
    rangeProto.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    });
  }
  if (typeof rangeProto.getClientRects !== "function") {
    rangeProto.getClientRects = () => [];
  }
}

const canvas2dMock = {
  fillRect: mock(),
  clearRect: mock(),
  getImageData: mock(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: mock(),
  createImageData: mock(() => []),
  setTransform: mock(),
  drawImage: mock(),
  save: mock(),
  restore: mock(),
  beginPath: mock(),
  moveTo: mock(),
  lineTo: mock(),
  closePath: mock(),
  stroke: mock(),
  translate: mock(),
  scale: mock(),
  rotate: mock(),
  arc: mock(),
  fill: mock(),
  measureText: mock(() => ({ width: 0 })),
  transform: mock(),
  rect: mock(),
  clip: mock(),
};

HTMLCanvasElement.prototype.getContext = function (contextType: string) {
  if (contextType === "2d" || (contextType && String(contextType).toLowerCase() === "2d")) return canvas2dMock as any;
  return null;
} as any;

HTMLCanvasElement.prototype.toDataURL = function () {
  return "data:image/png;base64,stub";
};

const mediaMock = {
  paused: true,
  duration: Number.NaN,
  _loaded: false,
  _load(media: HTMLMediaElement) {
    media.dispatchEvent(new Event("loadedmetadata"));
    media.dispatchEvent(new Event("loadeddata"));
    media.dispatchEvent(new Event("canplaythrough"));
  },
  _resetMock(media: HTMLMediaElement) {
    (media as any)._mock = { ...mediaMock };
  },
  _supportsTypes: ["video/mp4", "video/webm", "video/ogg", "audio/mp3", "audio/webm", "audio/ogg", "audio/wav"],
};

(window.HTMLMediaElement.prototype as any)._mock = mediaMock;

Object.defineProperty(window.HTMLMediaElement.prototype, "paused", {
  get() {
    return (this as any)._mock.paused;
  },
  configurable: true,
});

Object.defineProperty(window.HTMLMediaElement.prototype, "duration", {
  get() {
    return (this as any)._mock.duration;
  },
  set(value: number) {
    (window.HTMLMediaElement.prototype as any)._mock._resetMock(this);
    (this as any)._mock.duration = value;
  },
  configurable: true,
});

window.HTMLMediaElement.prototype.load = function () {
  const m = (this as any)._mock;
  if (!m._loaded) m._load(this);
  this.dispatchEvent(new Event("load"));
};

window.HTMLMediaElement.prototype.play = function () {
  const m = (this as any)._mock;
  if (!m._loaded) m._load(this);
  m.paused = false;
  this.dispatchEvent(new Event("play"));
};

window.HTMLMediaElement.prototype.pause = function () {
  (this as any)._mock.paused = true;
  this.dispatchEvent(new Event("pause"));
};

window.HTMLMediaElement.prototype.canPlayType = function (type: string) {
  return (window.HTMLMediaElement.prototype as any)._mock._supportsTypes.includes(type) ? "maybe" : "";
};

if (typeof (window as any).Image !== "undefined" && typeof (window as any).Image.prototype?.decode !== "function") {
  (window as any).Image.prototype.decode = async () => undefined;
}

const _origDocQuerySelector = document.querySelector.bind(document);
const _origDocQSAll = document.querySelectorAll.bind(document);
const _origGetComputedStyle = window.getComputedStyle;

afterEach(() => {
  // Restore real timers first — prevents fake timer leaks between files from
  // poisoning subsequent tests (e.g. lodash-replacements, throttle tests).
  // Must happen before RAF cleanup since clearTimeout needs real timers.
  try {
    jest.useRealTimers();
  } catch {
    /* ignore if already using real timers */
  }
  for (const timer of _pendingRAFs.values()) clearTimeout(timer);
  _pendingRAFs.clear();
  try {
    _rtlCleanup();
  } catch {
    /* prevent RTL act() cleanup from hanging the runner */
  }
  // Scrub leftover DOM nodes — RTL cleanup only removes its own containers;
  // direct DOM manipulations (appendChild, innerHTML, etc.) from earlier tests
  // accumulate in the test environment, bloating document.body over time.
  document.body.innerHTML = "";
  document.head.querySelectorAll("style:not([data-test-preload])").forEach((el) => el.remove());
  ensureSelectionApis();
  document.querySelector = _origDocQuerySelector;
  document.querySelectorAll = _origDocQSAll;
  window.getComputedStyle = _origGetComputedStyle;
  if (typeof (mock as any).restore === "function") {
    (mock as any).restore();
  }
  globalThis.fetch = createDefaultFetchMock();

  if (typeof fetchMock.resetMocks === "function") fetchMock.resetMocks();

  _resetMstMock(_safeGetRoot, (node: any) => {
    try {
      return _origGetRoot(node);
    } catch {
      return {};
    }
  });
  _resetMstMock(_safeGetEnv, (node: any) => {
    try {
      return _origGetEnv(node);
    } catch {
      return {};
    }
  });
  _resetMstMock(_safeGetParentOfType, (...a: any[]) => {
    try {
      return _origGetParentOfType(...a);
    } catch {
      return null;
    }
  });
  _resetMstMock(_safeIsAlive, (node: any) => {
    try {
      return _origIsAlive(node);
    } catch {
      return true;
    }
  });
  _resetMstMock(_safeDestroy, (...a: any[]) => {
    try {
      return _origDestroy(...a);
    } catch {
      /* noop */
    }
  });
  _resetMstMock(_safeGetType, (...a: any[]) => {
    try {
      return _origGetType(...a);
    } catch {
      return { name: "Unknown" };
    }
  });

  const settings = (window as any).APP_SETTINGS;
  if (settings?.user && typeof settings.user === "object" && typeof settings.user.id !== "number") {
    delete settings.user;
  }

  // Guard against tests that set window.APP_SETTINGS = undefined; ApiConfig.js reads
  // window.APP_SETTINGS.hostname at module-evaluation time, so a missing hostname
  // causes an unhandled error when the next test file is loaded in the same worker.
  if (!(window as any).APP_SETTINGS) {
    (window as any).APP_SETTINGS = { hostname: "http://localhost" };
  } else if (!(window as any).APP_SETTINGS.hostname) {
    (window as any).APP_SETTINGS = { ...(window as any).APP_SETTINGS, hostname: "http://localhost" };
  }
});
