import { useEffect, useRef, useState } from "react";
import { CHANNEL, fixture, validateSnapshot, type Snapshot } from "./model";
import sourceUrl from "./courtyard.svg?url";
import { DEFAULT_CONFIG, parseConfiguration } from "../preparation/configuration";
import { prepareImage, prepareTask, validateTask, type TaskDocument } from "../preparation/task";
import { TaskPreparation, type TaskDraft } from "../preparation/TaskPreparation";
import "./probe.css";

const fixtureTask = (actor: "human" | "ai"): TaskDocument => ({
  format: "playground-task-v1",
  config: DEFAULT_CONFIG,
  imageUrl: sourceUrl,
  snapshot: fixture(actor),
});
const INITIAL_TASK = fixtureTask("ai");
type Session = { id: string; input: TaskDocument };
type Output = { snapshot: Snapshot; wire: unknown[]; canUndo: boolean; canRedo: boolean; sequence: number };
export function ProbeApp() {
  const [active, setActive] = useState<Session | null>(null);
  const [candidate, setCandidate] = useState<Session | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [message, setMessage] = useState("Preparing the AI fixture…");
  const [error, setError] = useState("");
  const [json, setJson] = useState("");
  const [tab, setTab] = useState<"snapshot" | "wire">("snapshot");
  const [events, setEvents] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [replacement, setReplacement] = useState<{ task: TaskDocument; label: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const currentOutput = useRef<Output | null>(null);
  const baseline = useRef("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (replacement) dialog.current?.showModal();
  }, [replacement]);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const latest = useRef({ active, candidate });
  latest.current = { active, candidate };
  const log = (text: string) => setEvents((old) => [text, ...old].slice(0, 8));
  const currentTask = (): TaskDocument => ({
    ...(latest.current.active?.input ?? fixtureTask("ai")),
    snapshot: currentOutput.current?.snapshot ?? latest.current.active?.input.snapshot ?? fixture("ai"),
  });
  const activate = (task: TaskDocument, label: string) => {
    const next = { id: crypto.randomUUID(), input: task };
    latest.current.candidate = next;
    setCandidate(next);
    setReplacement(null);
    setError("");
    setMessage(`Preparing ${label}…`);
    log(`Requested ${label}`);
  };
  const cancelPreparation = () => {
    request.current?.abort();
    setPreparing(false);
    setReplacement(null);
    latest.current.candidate = null;
    setCandidate(null);
    setMessage(latest.current.active ? "Ready to annotate" : "Load or prepare a task to begin");
  };
  const runPreparation = async (factory: (signal: AbortSignal) => Promise<TaskDocument>, label: string) => {
    cancelPreparation();
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(
      () => controller.abort(new Error("Image preparation timed out. Try a smaller file or another URL.")),
      30000,
    );
    setPreparing(true);
    setError("");
    setMessage(`Validating ${label}…`);
    try {
      const task = await factory(controller.signal);
      controller.signal.throwIfAborted();
      if (currentOutput.current && JSON.stringify(currentOutput.current.snapshot) !== baseline.current) {
        setReplacement({ task, label });
        setMessage("Choose how to handle your current edits");
      } else activate(task, label);
    } catch (e) {
      if (
        !controller.signal.aborted ||
        (controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError")
      ) {
        setError(String(controller.signal.aborted ? controller.signal.reason : e));
        setMessage(latest.current.active ? "Current session retained" : "Task preparation failed");
        log("Rejected input; current session retained");
      }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) setPreparing(false);
    }
  };
  const prepare = (input: unknown, label: string) =>
    runPreparation(async (signal) => {
      if ((input as TaskDocument)?.format) return prepareTask(input, signal);
      const current = currentTask();
      const snapshot = validateSnapshot(input, parseConfiguration(current.config));
      if (JSON.stringify(snapshot.source) !== JSON.stringify(current.snapshot.source))
        throw new Error(
          "A bare snapshot must match the current image. Load a complete exported task for another source.",
        );
      return prepareTask({ ...current, snapshot }, signal);
    }, label);
  const applyDraft = (draft: TaskDraft) =>
    runPreparation(async (signal) => {
      const binding = parseConfiguration(draft.config);
      const current = currentTask();
      const sameResource =
        new URL(draft.imageUrl, location.href).href === new URL(current.imageUrl, location.href).href;
      if (draft.keep && !sameResource)
        throw new Error("The image has changed. Select Start with no rectangles for a new source.");
      if (draft.keep) validateSnapshot(current.snapshot, binding);
      const image = await prepareImage(draft.imageUrl, signal);
      const snapshot: Snapshot = draft.keep
        ? current.snapshot
        : { schemaVersion: 1, source: image.source, annotations: [] };
      if (snapshot.source.width !== image.source.width || snapshot.source.height !== image.source.height)
        throw new Error("Image dimensions changed; existing annotations were retained in the active task.");
      return validateTask({ format: "playground-task-v1", config: draft.config, imageUrl: image.imageUrl, snapshot });
    }, "configuration and image");
  const exportTask = (download = false) => {
    const task = currentTask();
    const text = JSON.stringify(task, null, 2);
    setJson(text);
    baseline.current = JSON.stringify(task.snapshot);
    setMessage("Complete task exported below");
    log("Exported configuration, image, and result");
    if (download) {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "playground-task.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== location.origin || data?.channel !== CHANNEL) return;
      const { active: current, candidate: pending } = latest.current;
      const session = [current, pending].find((s) => s?.id === data.generation);
      if (!session || frames.current.get(session.id)?.contentWindow !== event.source) return;
      if (data.type === "HELLO") {
        (event.source as Window).postMessage(
          { channel: CHANNEL, generation: session.id, type: "INIT", task: session.input },
          location.origin,
        );
      } else if (data.type === "ERROR") {
        setError(data.message);
        if (pending?.id === session.id) {
          latest.current.candidate = null;
          setCandidate(null);
        }
        setMessage(current ? "Current session retained" : "Session unavailable");
        log("Editor reported an error");
      } else if (data.type === "READY" && pending?.id === session.id) {
        latest.current = { active: session, candidate: null };
        setActive(session);
        setCandidate(null);
        setOutput(data);
        currentOutput.current = data;
        baseline.current = JSON.stringify(data.snapshot);
        setMessage("Ready to annotate");
        setError("");
        log("Ready · previous frame disposed");
      } else if (current?.id === session.id && ["CHANGE", "EXPORTED"].includes(data.type)) {
        setOutput(data);
        currentOutput.current = data;
        if (data.type === "EXPORTED") {
          setJson(JSON.stringify(data.snapshot, null, 2));
          baseline.current = JSON.stringify(data.snapshot);
          setMessage("Snapshot exported below");
          log("Exported current result");
        }
      }
    };
    window.addEventListener("message", receive);
    return () => {
      request.current?.abort();
      window.removeEventListener("message", receive);
    };
  }, []);
  useEffect(() => {
    void prepare(INITIAL_TASK, "AI fixture");
  }, []);
  useEffect(() => {
    if (!candidate) return;
    const id = candidate.id;
    const timer = setTimeout(() => {
      if (latest.current.candidate?.id !== id) return;
      latest.current.candidate = null;
      setCandidate(null);
      setError("Preparation timed out. The previous session has been retained.");
    }, 40000);
    return () => clearTimeout(timer);
  }, [candidate]);
  const command = (type: string) => {
    if (!active || candidate || preparing || replacement) return;
    frames.current
      .get(active.id)
      ?.contentWindow?.postMessage({ channel: CHANNEL, generation: active.id, type }, location.origin);
  };
  const dispose = () => {
    cancelPreparation();
    currentOutput.current = null;
    baseline.current = "";
    latest.current = { active: null, candidate: null };
    setActive(null);
    setCandidate(null);
    setOutput(null);
    setError("");
    setMessage("Disposed · load a fixture to start again");
    log("Disposed all frames");
  };
  const busy = !!candidate || preparing || !!replacement || !active;
  return (
    <main className="probe-app">
      <header className="probe-header">
        <div>
          <span className="probe-eyebrow">PLAYGROUND / COMPONENT LAB</span>
          <h1>Your data. Your labels.</h1>
          <p>Prepare a task, annotate it, and take the result with you.</p>
        </div>
        <a href="?">Open Playground ↗</a>
      </header>
      <section className="probe-toolbar" aria-label="Session controls">
        <div>
          <button onClick={() => prepare(fixtureTask("ai"), "AI fixture")}>Load AI fixture</button>
          <button onClick={() => prepare(fixtureTask("human"), "human fixture")}>Load human fixture</button>
        </div>
        <div>
          <button disabled={busy || !output?.canUndo} onClick={() => command("UNDO")}>
            Undo
          </button>
          <button disabled={busy || !output?.canRedo} onClick={() => command("REDO")}>
            Redo
          </button>
          <button disabled={busy} onClick={() => command("EXPORT")}>
            Export snapshot
          </button>
          <button onClick={dispose}>Dispose</button>
          <button disabled={busy} onClick={() => exportTask()}>
            Export task
          </button>
        </div>
      </section>
      <div className="probe-status" role="status">
        <span className={candidate ? "probe-dot busy" : "probe-dot"} />
        {message}
        <span>{active ? `Session ${active.id.slice(0, 8)}` : "No active session"}</span>
      </div>
      {error && (
        <div className="probe-error" role="alert">
          {error}
        </div>
      )}
      {replacement && (
        <dialog
          ref={dialog}
          className="task-replacement"
          aria-label="Unsaved task changes"
          onCancel={() => {
            setReplacement(null);
            setMessage("Ready to annotate");
          }}
        >
          <h2>Keep a copy of your edits?</h2>
          <p>Your current task has unexported changes. A replacement starts fresh undo history.</p>
          <button
            autoFocus
            onClick={() => {
              exportTask(true);
              activate(replacement.task, replacement.label);
            }}
          >
            Export &amp; replace
          </button>
          <button onClick={() => activate(replacement.task, replacement.label)}>Replace task</button>
          <button
            onClick={() => {
              setReplacement(null);
              setMessage("Ready to annotate");
            }}
          >
            Keep editing
          </button>
        </dialog>
      )}
      <TaskPreparation
        task={active?.input ?? INITIAL_TASK}
        busy={!!candidate || preparing || !!replacement}
        onApply={applyDraft}
        onDraftChange={cancelPreparation}
      />
      <div className="probe-grid">
        <section className="probe-workbench">
          <div className="probe-section-title">
            <h2>Editing surface</h2>
            <span>
              {active?.input.snapshot.source.width ?? "—"} × {active?.input.snapshot.source.height ?? "—"} · image
              coordinates
            </span>
          </div>
          <div className="probe-canvas">
            {!active && (
              <div className="probe-empty">
                {candidate ? "Loading the editor and local image…" : "Load a fixture to begin."}
              </div>
            )}
            {[active, candidate]
              .filter((s): s is Session => !!s)
              .map((session) => (
                <iframe
                  key={session.id}
                  ref={(el) => {
                    if (el) {
                      el.inert = busy;
                      frames.current.set(session.id, el);
                    } else frames.current.delete(session.id);
                  }}
                  title={session.id === active?.id ? "Annotation editor" : "Preparing annotation editor"}
                  src={`?component-probe=frame&generation=${session.id}`}
                  className={session.id === active?.id ? "probe-frame" : "probe-frame preparing"}
                  tabIndex={session.id === active?.id ? 0 : -1}
                  aria-hidden={session.id !== active?.id}
                />
              ))}
            {(candidate || preparing || replacement) && active && (
              <div className="probe-loading">Preparing replacement… current history is preserved until ready.</div>
            )}
          </div>
          <div className="probe-actions">
            <span>Repeatable checks for rectangle r1</span>
            <button disabled={busy} onClick={() => command("MOVE")}>
              Move right 50 px
            </button>
            <button disabled={busy} onClick={() => command("RELABEL")}>
              Toggle label
            </button>
          </div>
        </section>
        <aside className="probe-inspector">
          <div className="probe-section-title">
            <h2>Result inspector</h2>
            <span>{output?.snapshot.annotations.length ?? 0} rectangles</span>
          </div>
          <div className="probe-tabs">
            <button aria-pressed={tab === "snapshot"} onClick={() => setTab("snapshot")}>
              Image coordinates
            </button>
            <button aria-pressed={tab === "wire"} onClick={() => setTab("wire")}>
              Editor wire format
            </button>
          </div>
          <pre data-testid="probe-output">
            {output ? JSON.stringify(tab === "snapshot" ? output.snapshot : output.wire, null, 2) : "No result yet."}
          </pre>
        </aside>
      </div>
      <div className="probe-bottom">
        <section>
          <h2>Round-trip a snapshot or complete task</h2>
          <p>A task includes configuration and image data. A bare snapshot uses the current image and configuration.</p>
          <textarea
            aria-label="Snapshot JSON"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            placeholder="Export a snapshot or paste one here…"
          />
          <button
            onClick={() => {
              try {
                prepare(JSON.parse(json), "snapshot");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Load snapshot
          </button>
        </section>
        <section>
          <h2>Two modules, working together</h2>
          <p>
            Configuration and source preparation feed a validated, isolated annotation session. Image bytes are embedded
            on import, so task exports can be reopened independently.
          </p>
          <p className="probe-note">
            Compatibility limits: editor gestures constrain shapes at image edges. Native hit-testing and arbitrary
            provenance are not certified by this probe. Loading a replacement starts fresh history.
          </p>
          <h3>Session activity</h3>
          <ol>
            {events.map((event, i) => (
              <li key={`${i}-${event}`}>{event}</li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
