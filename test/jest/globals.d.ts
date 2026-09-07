/// <reference types="jest" />
import "@testing-library/jest-dom";

export {};
declare global {
  var mock: typeof jest.fn & {
    clearAllMocks: typeof jest.clearAllMocks;
    restoreAllMocks: typeof jest.restoreAllMocks;
    restore: typeof jest.restoreAllMocks;
  };
  var spyOn: typeof jest.spyOn;
  var useFakeTimers: typeof jest.useFakeTimers;
  var useRealTimers: typeof jest.useRealTimers;
  var advanceTimersByTime: typeof jest.advanceTimersByTime;
  var runAllTimers: typeof jest.runAllTimers;
  var setSystemTime: typeof jest.setSystemTime;
  var clearAllMocks: typeof jest.clearAllMocks;
  var resetAllMocks: typeof jest.resetAllMocks;
  var restoreAllMocks: typeof jest.restoreAllMocks;
  var resetModules: typeof jest.resetModules;
  var mockModule: (runtime: typeof jest, id: string, factory?: () => unknown) => void;
  interface MockFFControls {
    setup(): void;
    set(kv: Record<string, boolean>): void;
    reset(): void;
  }

  var mockFF: () => MockFFControls;

  // ---------------------------------------------------------------------------
  // APP_SETTINGS on window (initialised in preload.ts)
  // ---------------------------------------------------------------------------

  interface AppSettings {
    hostname?: string;
    feature_flags?: Record<string, boolean>;
    user?: { id?: number; [key: string]: unknown };
    [key: string]: unknown;
  }

  interface Window {
    APP_SETTINGS: AppSettings;
  }

  var APP_SETTINGS: AppSettings;
}
