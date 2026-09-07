import { useEffect, useRef } from "react";
import { onSnapshot } from "mobx-state-tree";
import { CHANNEL, DEFAULT_BINDING, fromWire, toWire } from "./model";
import { parseConfiguration } from "../preparation/configuration";
import { validateTask, type TaskDocument } from "../preparation/task";

export function ProbeFrame() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const generation = new URLSearchParams(location.search).get("generation");
    let instance: any;
    let task: TaskDocument;
    let binding = DEFAULT_BINDING;
    let disposed = false;
    let started = false;
    let ready = false;
    let pointerPressed = false;
    let timer: ReturnType<typeof setTimeout>;
    let disposeSnapshot: (() => void) | undefined;
    let sequence = 0;

    const onPointerDown = () => {
      pointerPressed = true;
    };
    const onPointerUp = () => {
      pointerPressed = false;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);

    const send = (type: string, payload: object = {}) =>
      parent.postMessage({ channel: CHANNEL, generation, type, ...payload }, location.origin);

    const publish = (type = "CHANGE") => {
      const annotation = instance?.store?.annotationStore?.selected;
      if (!ready || !annotation || disposed) return;
      try {
        const wire = annotation.serializeAnnotation();
        send(type, {
          snapshot: fromWire(wire, task.snapshot.source, binding),
          wire,
          sequence: ++sequence,
          canUndo: annotation.history.canUndo,
          canRedo: annotation.history.canRedo,
        });
      } catch (error) {
        send("ERROR", { message: String(error) });
      }
    };

    const isGestureActive = (annotation: any): boolean => {
      if (pointerPressed) return true;
      if (annotation.isDrawing || annotation.dragMode) return true;

      const image = annotation?.names?.get(binding.imageName);
      if (image?.drawingRegion || image?.isDrawing) return true;

      const toolsManager = image?.toolsManager;
      if (toolsManager) {
        const drawingTool = toolsManager.findDrawingTool?.();
        if (drawingTool && (drawingTool.isDrawing || drawingTool.currentArea)) return true;
      }

      if (annotation.areas) {
        for (const area of annotation.areas.values()) {
          if (area.isDrawing) return true;
        }
      }

      if (annotation.history?.isFrozen) return true;

      return false;
    };

    const initialize = async (input: unknown) => {
      if (started) return;
      started = true;
      try {
        task = validateTask(input);
        const snapshot = task.snapshot;
        binding = parseConfiguration(task.config);
        const { LabelStudio } = await import("@humansignal/editor");
        if (disposed) return;
        instance = new LabelStudio(root.current, {
          config: task.config,
          task: {
            id: 1,
            data: { [binding.dataKey]: task.imageUrl },
            annotations: [{ id: 1, result: toWire(snapshot, binding) }],
            predictions: [],
          },
          interfaces: ["controls", "side-column", "edit-history"],
          instanceOptions: { reactVersion: "v18" },
          settings: { fullscreen: false },
        });
        const deadline = Date.now() + 25000;
        const waitForReady = () => {
          if (disposed) return;
          const store = instance.store;
          const annotation = store?.annotationStore?.selected;
          const image = annotation?.names?.get(binding.imageName);
          if (annotation && image?.currentImageEntity?.imageLoaded && root.current?.querySelector("canvas")) {
            if (image.naturalWidth !== snapshot.source.width || image.naturalHeight !== snapshot.source.height) {
              send("ERROR", { message: "Decoded image dimensions do not match the task." });
              return;
            }
            annotation.reinitHistory();
            ready = true;
            disposeSnapshot = onSnapshot(annotation, () => publish());
            publish("READY");
          } else if (Date.now() > deadline)
            send("ERROR", { message: "Editor did not become ready within 25 seconds." });
          else timer = setTimeout(waitForReady, 50);
        };
        waitForReady();
      } catch (error) {
        send("ERROR", { message: String(error) });
      }
    };

    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== parent ||
        event.data?.channel !== CHANNEL ||
        event.data.generation !== generation
      )
        return;
      const { type, requestId, task: input } = event.data;
      if (type === "INIT") {
        void initialize(input);
        return;
      }
      if (!ready) {
        if (type === "CAPTURE_REQUEST") {
          send("CAPTURE_RESPONSE", {
            requestId,
            success: false,
            error: "Editor is not ready yet",
            code: "NOT_READY",
          });
        }
        return;
      }
      const annotation = instance.store.annotationStore.selected;
      try {
        if (type === "CAPTURE_REQUEST") {
          if (isGestureActive(annotation)) {
            send("CAPTURE_RESPONSE", {
              requestId,
              success: false,
              error:
                "An annotation gesture is currently in progress. Complete or release it before saving or accepting.",
              code: "GESTURE_ACTIVE",
            });
            return;
          }
          const wire = annotation.serializeAnnotation();
          const snapshot = fromWire(wire, task.snapshot.source, binding);
          const capturedTask: TaskDocument = {
            format: "playground-task-v1",
            config: task.config,
            imageUrl: task.imageUrl,
            snapshot,
          };
          send("CAPTURE_RESPONSE", {
            requestId,
            success: true,
            task: capturedTask,
          });
          return;
        }

        if (type === "UNDO") annotation.undo();
        else if (type === "REDO") annotation.redo();
        else if (type === "EXPORT") {
          publish("EXPORTED");
          return;
        } else if (type === "MOVE" || type === "RELABEL") {
          const area = Array.from(annotation.areas.values()).find((r: any) => r.cleanId === "r1") as any;
          if (!area) throw new Error("The fixture rectangle r1 has been deleted. Load a fixture to try this action.");
          const delta = (50 / task.snapshot.source.width) * 100;
          if (type === "MOVE" && area.x + area.width + delta > 100) throw new Error("Move would exceed image bounds.");
          annotation.history.freeze("probe-command");
          try {
            if (type === "MOVE")
              area.setPosition(
                area.parent.internalToCanvasX(area.x + delta),
                area.parent.internalToCanvasY(area.y),
                area.parent.internalToCanvasX(area.width),
                area.parent.internalToCanvasY(area.height),
                0,
              );
            else
              area.results[0].setValue([
                binding.labels[(binding.labels.indexOf(area.labels[0]) + 1) % binding.labels.length],
              ]);
            area.notifyDrawingFinished();
          } finally {
            annotation.history.unfreeze("probe-command");
          }
        } else return;
        publish();
      } catch (error) {
        if (type === "CAPTURE_REQUEST") {
          send("CAPTURE_RESPONSE", {
            requestId,
            success: false,
            error: String(error),
            code: "SERIALIZATION_ERROR",
          });
        } else {
          send("ERROR", { message: String(error) });
        }
      }
    };

    window.addEventListener("message", receive);
    send("HELLO");
    return () => {
      disposed = true;
      clearTimeout(timer);
      disposeSnapshot?.();
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("message", receive);
      instance?.destroy?.();
    };
  }, []);
  return <div ref={root} style={{ height: "100vh", width: "100%", overflow: "auto" }} />;
}
