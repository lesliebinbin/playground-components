import { useEffect, useRef, useState } from "react";
import { CHANNEL, fixture, validateSnapshot, type Snapshot } from "./model";
import "./probe.css";

type Session = { id: string; input: Snapshot };
type Output = { snapshot: Snapshot; wire: unknown[]; canUndo: boolean; canRedo: boolean; sequence: number };
export function ProbeApp() {
  const [active, setActive] = useState<Session | null>(null);
  const [candidate, setCandidate] = useState<Session | null>(() => ({ id: crypto.randomUUID(), input: fixture("ai") }));
  const [output, setOutput] = useState<Output | null>(null);
  const [message, setMessage] = useState("Preparing the AI fixture…");
  const [error, setError] = useState("");
  const [json, setJson] = useState("");
  const [tab, setTab] = useState<"snapshot" | "wire">("snapshot");
  const [events, setEvents] = useState<string[]>([]);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const latest = useRef({ active, candidate });
  latest.current = { active, candidate };
  const log = (text: string) => setEvents((old) => [text, ...old].slice(0, 8));
  const prepare = (input: unknown, label: string) => {
    try {
      const snapshot = validateSnapshot(input);
      const next = { id: crypto.randomUUID(), input: snapshot };
      latest.current.candidate = next;
      setCandidate(next);
      setError("");
      setMessage(`Preparing ${label}…`);
      log(`Requested ${label}`);
    } catch (e) {
      setError(String(e));
      log("Rejected input; current session retained");
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
          { channel: CHANNEL, generation: session.id, type: "INIT", snapshot: session.input },
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
        setMessage("Ready to annotate");
        setError("");
        log("Ready · previous frame disposed");
      } else if (current?.id === session.id && ["CHANGE", "EXPORTED"].includes(data.type)) {
        setOutput(data);
        if (data.type === "EXPORTED") {
          setJson(JSON.stringify(data.snapshot, null, 2));
          setMessage("Snapshot exported below");
          log("Exported current result");
        }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
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
    if (!active || candidate) return;
    frames.current
      .get(active.id)
      ?.contentWindow?.postMessage({ channel: CHANNEL, generation: active.id, type }, location.origin);
  };
  const dispose = () => {
    latest.current = { active: null, candidate: null };
    setActive(null);
    setCandidate(null);
    setOutput(null);
    setError("");
    setMessage("Disposed · load a fixture to start again");
    log("Disposed all frames");
  };
  const busy = !!candidate || !active;
  return (
    <main className="probe-app">
      <header className="probe-header">
        <div>
          <span className="probe-eyebrow">PLAYGROUND / COMPONENT LAB</span>
          <h1>Annotation, in isolation.</h1>
          <p>Load a result. Make an edit. See what survives.</p>
        </div>
        <a href="?">Open Playground ↗</a>
      </header>
      <section className="probe-toolbar" aria-label="Session controls">
        <div>
          <button onClick={() => prepare(fixture("ai"), "AI fixture")}>Load AI fixture</button>
          <button onClick={() => prepare(fixture("human"), "human fixture")}>Load human fixture</button>
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
      <div className="probe-grid">
        <section className="probe-workbench">
          <div className="probe-section-title">
            <h2>Editing surface</h2>
            <span>1000 × 800 · image coordinates</span>
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
                    if (el) frames.current.set(session.id, el);
                    else frames.current.delete(session.id);
                  }}
                  title={session.id === active?.id ? "Annotation editor" : "Preparing annotation editor"}
                  src={`?component-probe=frame&generation=${session.id}`}
                  className={session.id === active?.id ? "probe-frame" : "probe-frame preparing"}
                  tabIndex={session.id === active?.id ? 0 : -1}
                  aria-hidden={session.id !== active?.id}
                />
              ))}
            {candidate && active && (
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
          <h2>Round-trip a snapshot</h2>
          <p>
            Export, inspect the JSON, then load it into a fresh session. Invalid input leaves the current editor intact.
          </p>
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
          <h2>What this proves</h2>
          <p>A real editor session with isolated lifecycle, explicit result conversion, and observable undo/redo.</p>
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
