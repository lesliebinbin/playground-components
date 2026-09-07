/** Jest resolves extensionless and absolute imports to the same module. */
export const VIRTUAL_VIDEO_MODULE_SPECIFIERS = ["../VirtualVideo"];
export const VIRTUAL_CANVAS_MODULE_SPECIFIERS = ["../VirtualCanvas"];

export function mockModuleAllSpecifiers(specifiers: readonly string[], factory: () => Record<string, unknown>): void {
  for (const spec of specifiers) mockModule(jest, spec, factory);
}
