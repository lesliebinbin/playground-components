/**
 * Side-effect module: register Infomodal + real `VirtualVideo` in the the previous runner registry before any
 * `import("../VirtualVideo")` runs.
 *
 * `VirtualVideo.test.tsx` must **not** static-import `../VirtualVideo` alongside this file — sibling
 * imports can be evaluated in either order, so setup can run too late on CI. Use `beforeAll` +
 * dynamic `import("../VirtualVideo")` there instead.
 *
 * Re-binds the real `VirtualVideo` for every specifier alias (`videoCanvasModuleMocks.ts`)
 * when another test file mocked under a different key.
 */
mockModule(jest, "../../Infomodal/Infomodal", () => ({
  __esModule: true,
  __skipMerge: true,
  default: {
    error: mock(),
    warning: mock(),
    success: mock(),
    info: mock(),
  },
}));
