/**
 * RTL test harness for the LabelStudio editor.
 * Renders the editor with the same config/task/annotations pattern as Cypress LabelStudio.params().
 * Use for DOM-only and serialization tests without a real browser.
 */
import { render, screen } from "@testing-library/react";
import { EventInvoker } from "../utils/events";
import defaultOptions from "../defaultOptions";
import { configureStore } from "../configureStore";

export type RenderEditorOptions = {
  config: string;
  task?: {
    id?: number;
    data?: Record<string, unknown>;
    annotations?: Array<{ id: number; result: unknown[] }>;
    predictions?: Array<{ id: number; result: unknown[] }>;
  };
  interfaces?: string[];
};

const defaultTask = {
  id: 1,
  data: {},
  annotations: [] as Array<{ id: number; result: unknown[] }>,
  predictions: [] as Array<{ id: number; result: unknown[] }>,
};

/**
 * Renders the LabelStudio editor with the given config and task.
 * Returns the store, container, RTL screen helpers, and a serialize() helper for the selected annotation.
 */
export async function renderEditor(options: RenderEditorOptions) {
  // App registers object, control, and visual tags before the store parses XML.
  const { default: App } = await import("../components/App/App");
  const { config, task = defaultTask, interfaces = defaultOptions.interfaces } = options;
  const params = {
    ...defaultOptions,
    config,
    interfaces,
    task: {
      ...defaultTask,
      ...task,
      annotations: task.annotations ?? defaultTask.annotations,
      predictions: task.predictions ?? defaultTask.predictions,
    },
  };

  const { store } = await configureStore(params, new EventInvoker());
  (window as Window & { Htx?: typeof store }).Htx = store;
  const container = document.createElement("div");
  document.body.appendChild(container);

  const result = render(<App store={store} />, { container });

  return {
    store,
    container,
    unmount: result.unmount,
    serialize: () => store.annotationStore.selected?.serializeAnnotation?.(),
    ...screen,
  };
}
