import { useEffect, useRef } from "react";
import { onSnapshot } from "mobx-state-tree";
import { CHANNEL, SOURCE, fromWire, toWire, validateSnapshot } from "./model";
import sourceUrl from "./courtyard.svg?url";

const config = `<View><Image name="image" value="$image" zoom="true"/><RectangleLabels name="label" toName="image" canRotate="false"><Label value="Person" background="#16877b"/><Label value="Vehicle" background="#b86c45"/></RectangleLabels></View>`;

export function ProbeFrame() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const generation = new URLSearchParams(location.search).get("generation");
    let instance: any;
    let disposed = false;
    let started = false;
    let ready = false;
    let timer: ReturnType<typeof setTimeout>;
    let disposeSnapshot: (() => void) | undefined;
    let sequence = 0;
    const send = (type: string, payload: object = {}) =>
      parent.postMessage({ channel: CHANNEL, generation, type, ...payload }, location.origin);
    const publish = (type = "CHANGE") => {
      const annotation = instance?.store?.annotationStore?.selected;
      if (!ready || !annotation || disposed) return;
      try {
        const wire = annotation.serializeAnnotation();
        send(type, {
          snapshot: fromWire(wire),
          wire,
          sequence: ++sequence,
          canUndo: annotation.history.canUndo,
          canRedo: annotation.history.canRedo,
        });
      } catch (error) {
        send("ERROR", { message: String(error) });
      }
    };
    const initialize = async (input: unknown) => {
      if (started) return;
      started = true;
      try {
        const snapshot = validateSnapshot(input);
        const { LabelStudio } = await import("@humansignal/editor");
        if (disposed) return;
        instance = new LabelStudio(root.current, {
          config,
          task: {
            id: 1,
            data: { image: sourceUrl },
            annotations: [{ id: 1, result: toWire(snapshot) }],
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
          const image = annotation?.names?.get("image");
          if (annotation && image?.currentImageEntity?.imageLoaded && root.current?.querySelector("canvas")) {
            if (image.naturalWidth !== SOURCE.width || image.naturalHeight !== SOURCE.height) {
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
      const { type, snapshot } = event.data;
      if (type === "INIT") {
        void initialize(snapshot);
        return;
      }
      if (!ready) return;
      const annotation = instance.store.annotationStore.selected;
      try {
        if (type === "UNDO") annotation.undo();
        else if (type === "REDO") annotation.redo();
        else if (type === "EXPORT") {
          publish("EXPORTED");
          return;
        } else if (type === "MOVE" || type === "RELABEL") {
          const area = Array.from(annotation.areas.values()).find((r: any) => r.cleanId === "r1") as any;
          if (!area) throw new Error("The fixture rectangle r1 has been deleted. Load a fixture to try this action.");
          if (type === "MOVE" && area.x + area.width + 5 > 100) throw new Error("Move would exceed image bounds.");
          annotation.history.freeze("probe-command");
          try {
            if (type === "MOVE")
              area.setPosition(
                area.parent.internalToCanvasX(area.x + 5),
                area.parent.internalToCanvasY(area.y),
                area.parent.internalToCanvasX(area.width),
                area.parent.internalToCanvasY(area.height),
                0,
              );
            else area.results[0].setValue([area.labels[0] === "Person" ? "Vehicle" : "Person"]);
            area.notifyDrawingFinished();
          } finally {
            annotation.history.unfreeze("probe-command");
          }
        } else return;
        publish();
      } catch (error) {
        send("ERROR", { message: String(error) });
      }
    };
    window.addEventListener("message", receive);
    send("HELLO");
    return () => {
      disposed = true;
      clearTimeout(timer);
      disposeSnapshot?.();
      window.removeEventListener("message", receive);
      instance?.destroy?.();
    };
  }, []);
  return <div ref={root} style={{ height: "100vh", width: "100%", overflow: "auto" }} />;
}
