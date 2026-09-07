import { useEffect, useRef, useState, useMemo } from "react";
import { CHANNEL, fixture, validateSnapshot, type Snapshot } from "./model";
import sourceUrl from "./courtyard.svg?url";
import { DEFAULT_CONFIG, parseConfiguration } from "../preparation/configuration";
import { prepareImage, prepareTask, validateTask, type TaskDocument } from "../preparation/task";
import { TaskPreparation, type TaskDraft } from "../preparation/TaskPreparation";
import {
  IndexedDbHostStorage,
  type HostStorage,
  type TaskMetadata,
  type StoredAcceptedRevision,
  VersionConflictError,
  InvalidOperationError,
  StorageCorruptError,
} from "../host/storage";
import "./probe.css";

const fixtureTask = (actor: "human" | "ai"): TaskDocument => ({
  format: "playground-task-v1",
  config: DEFAULT_CONFIG,
  imageUrl: sourceUrl,
  snapshot: fixture(actor),
});
const INITIAL_TASK = fixtureTask("ai");

type Session = {
  id: string; // Ephemeral session generation
  taskId: string; // Logical task identity
  taskVersion: number;
  currentDraftVersion: number;
  savedBaseline: string | null;
  input: TaskDocument;
};

type Output = {
  snapshot: Snapshot;
  wire: unknown[];
  canUndo: boolean;
  canRedo: boolean;
  sequence: number;
};

type DisplayMode = "all" | "preview" | "preview-inline";
type Disclosure = "configuration" | "inspection" | "lifecycle";

const displayModes: { mode: DisplayMode; label: string }[] = [
  { mode: "all", label: "Full mode" },
  { mode: "preview", label: "Preview" },
  { mode: "preview-inline", label: "Preview inline" },
];

const initialDisplayMode = (): DisplayMode => {
  const mode = new URLSearchParams(location.search).get("mode");
  return displayModes.some(({ mode: valid }) => valid === mode) ? (mode as DisplayMode) : "all";
};

const inspectedTask = (task: TaskDocument) => ({
  format: task.format,
  config: task.config,
  imageUrl: task.imageUrl.startsWith("data:")
    ? "[Embedded image bytes omitted from this inspector; complete task export retains them.]"
    : task.imageUrl,
  snapshot: task.snapshot,
});

export function ProbeApp({ storageOverride }: { storageOverride?: HostStorage } = {}) {
  const storage = useMemo<HostStorage>(() => storageOverride ?? new IndexedDbHostStorage(), [storageOverride]);

  const [active, setActive] = useState<Session | null>(null);
  const [candidate, setCandidate] = useState<Session | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [message, setMessage] = useState("Preparing the AI fixture…");
  const [error, setError] = useState("");
  const [json, setJson] = useState("");
  const [tab, setTab] = useState<"snapshot" | "wire">("snapshot");
  const [events, setEvents] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [replacement, setReplacement] = useState<{
    task: TaskDocument;
    label: string;
    taskId?: string;
    taskVersion?: number;
    currentDraftVersion?: number;
    savedBaseline?: string | null;
  } | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(initialDisplayMode);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [disclosures, setDisclosures] = useState<Record<Disclosure, boolean>>({
    configuration: true,
    inspection: true,
    lifecycle: true,
  });
  const [copyState, setCopyState] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [copyError, setCopyError] = useState("");

  // Host lifecycle state
  const [savedTasks, setSavedTasks] = useState<TaskMetadata[]>([]);
  const [selectedSavedTaskId, setSelectedSavedTaskId] = useState<string>("");
  const [isStoragePending, setIsStoragePending] = useState(false);
  const [acceptedRevisions, setAcceptedRevisions] = useState<StoredAcceptedRevision[]>([]);
  const [inspectedRevision, setInspectedRevision] = useState<StoredAcceptedRevision | null>(null);
  const [pendingRetryAcceptance, setPendingRetryAcceptance] = useState<{
    generation: string;
    taskId: string;
    operationId: string;
    expectedTaskVersion: number;
    document: TaskDocument;
  } | null>(null);

  const copyOperation = useRef(0);
  const revisionLoadOperation = useRef(0);
  const savedTasksRead = useRef(0);
  const mounted = useRef(true);
  const storagePending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const currentOutput = useRef<Output | null>(null);
  const exportBaseline = useRef("");
  const dialog = useRef<HTMLDialogElement>(null);
  const currentReplacement = useRef<{
    task: TaskDocument;
    label: string;
    taskId?: string;
    taskVersion?: number;
    currentDraftVersion?: number;
    savedBaseline?: string | null;
  } | null>(null);
  currentReplacement.current = replacement;

  const pendingCaptures = useRef<
    Map<string, { generation: string; resolve: (task: TaskDocument) => void; reject: (err: Error) => void }>
  >(new Map());

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

  const refreshSavedTasks = async () => {
    const op = ++savedTasksRead.current;
    try {
      const list = await storage.listTasks();
      if (!mounted.current || op !== savedTasksRead.current) return;
      setSavedTasks(list);
    } catch (e) {
      if (!mounted.current || op !== savedTasksRead.current) return;
      setError(e instanceof Error ? `Failed to load saved tasks: ${e.message}` : String(e));
    }
  };

  useEffect(() => {
    mounted.current = true;
    void refreshSavedTasks();
    return () => {
      mounted.current = false;
      savedTasksRead.current++;
    };
  }, [storage]);

  const loadRevisionsForActiveTask = async (taskId: string, expectedGeneration: string) => {
    const op = ++revisionLoadOperation.current;
    try {
      const revs = await storage.listAcceptedRevisions(taskId);
      if (latest.current.active?.id !== expectedGeneration || revisionLoadOperation.current !== op) return;
      setAcceptedRevisions(revs);
      if (revs.length > 0) {
        setInspectedRevision(revs[0]);
      } else {
        setInspectedRevision(null);
      }
    } catch (e) {
      if (latest.current.active?.id !== expectedGeneration || revisionLoadOperation.current !== op) return;
      setError(e instanceof Error ? `Failed to list revisions: ${e.message}` : String(e));
      setAcceptedRevisions([]);
      setInspectedRevision(null);
    }
  };

  const captureActiveTask = async (activeSession: Session): Promise<TaskDocument> => {
    const frame = frames.current.get(activeSession.id);
    if (!frame?.contentWindow) {
      throw new Error("Active editor frame is not available");
    }
    const requestId = crypto.randomUUID();
    return new Promise<TaskDocument>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCaptures.current.delete(requestId);
        reject(new Error("Capture request timed out"));
      }, 10000);

      pendingCaptures.current.set(requestId, {
        generation: activeSession.id,
        resolve: (doc) => {
          clearTimeout(timeout);
          resolve(doc);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      frame.contentWindow.postMessage(
        { channel: CHANNEL, generation: activeSession.id, type: "CAPTURE_REQUEST", requestId },
        location.origin,
      );
    });
  };

  const activate = (
    task: TaskDocument,
    label: string,
    hostInfo?: { taskId?: string; taskVersion?: number; currentDraftVersion?: number; savedBaseline?: string | null },
  ) => {
    const taskId = hostInfo?.taskId ?? crypto.randomUUID();
    const taskVersion = hostInfo?.taskVersion ?? 0;
    const currentDraftVersion = hostInfo?.currentDraftVersion ?? 0;
    const initialSavedBaseline = hostInfo ? (hostInfo.savedBaseline ?? null) : null;

    const next: Session = {
      id: crypto.randomUUID(),
      taskId,
      taskVersion,
      currentDraftVersion,
      savedBaseline: initialSavedBaseline,
      input: task,
    };

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

  type PreparedResult = {
    task: TaskDocument;
    hostInfo?: {
      taskId?: string;
      taskVersion?: number;
      currentDraftVersion?: number;
      savedBaseline?: string | null;
    };
  };

  const runPreparation = async (
    factory: (signal: AbortSignal) => Promise<PreparedResult | TaskDocument>,
    label: string,
    defaultHostInfo?: {
      taskId?: string;
      taskVersion?: number;
      currentDraftVersion?: number;
      savedBaseline?: string | null;
    },
  ) => {
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
      const res = await factory(controller.signal);
      controller.signal.throwIfAborted();
      const task = "task" in res ? res.task : res;
      const hostInfo = "hostInfo" in res ? res.hostInfo : defaultHostInfo;

      // Check if current active task has unsaved/unexported edits
      const currentSnap = currentOutput.current ? JSON.stringify(currentOutput.current.snapshot) : "";
      const isDurablePersisted =
        (latest.current.active?.taskVersion ?? 0) > 0 || latest.current.active?.savedBaseline !== null;
      let isDirty = false;
      if (isDurablePersisted) {
        isDirty = currentSnap !== latest.current.active?.savedBaseline;
      } else {
        isDirty = !!currentOutput.current && currentSnap !== exportBaseline.current;
      }

      if (currentOutput.current && isDirty) {
        setReplacement({
          task,
          label,
          taskId: hostInfo?.taskId,
          taskVersion: hostInfo?.taskVersion,
          currentDraftVersion: hostInfo?.currentDraftVersion,
          savedBaseline: hostInfo?.savedBaseline,
        });
        setMessage("Choose how to handle your current edits");
      } else {
        activate(task, label, hostInfo);
      }
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
    exportBaseline.current = JSON.stringify(task.snapshot);
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

  // Host lifecycle actions: Save draft
  const saveDraft = async () => {
    if (!active || storagePending.current) return;
    storagePending.current = true;
    setIsStoragePending(true);
    setError("");
    setMessage("Capturing and saving draft…");

    const sessionAtStart = active;
    try {
      const captured = await captureActiveTask(sessionAtStart);
      const result = await storage.saveDraft({
        taskId: sessionAtStart.taskId,
        expectedTaskVersion: sessionAtStart.taskVersion,
        document: captured,
        name: `Task ${sessionAtStart.taskId.slice(0, 8)}`,
      });

      // Update active session only if session still matches
      if (latest.current.active?.id === sessionAtStart.id) {
        const serialized = JSON.stringify(captured.snapshot);
        setActive((cur) =>
          cur && cur.id === sessionAtStart.id
            ? {
                ...cur,
                taskVersion: result.taskVersion,
                currentDraftVersion: result.draftVersion,
                savedBaseline: serialized,
              }
            : cur,
        );
        setMessage("Draft saved successfully");
        log(`Saved draft v${result.draftVersion}`);
      }
      void refreshSavedTasks();
    } catch (err) {
      if (latest.current.active?.id === sessionAtStart.id) {
        if (err instanceof VersionConflictError) {
          setError(`Conflict saving draft: expected version ${err.expected}, actual ${err.actual}`);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
        setMessage("Draft save failed · working data preserved");
        log("Draft save failed");
      }
    } finally {
      storagePending.current = false;
      setIsStoragePending(false);
    }
  };

  // Host lifecycle actions: Accept revision
  const acceptRevision = async (retryPayload?: {
    generation: string;
    taskId: string;
    operationId: string;
    expectedTaskVersion: number;
    document: TaskDocument;
  }) => {
    if (!active || storagePending.current) return;
    if (retryPayload && (retryPayload.generation !== active.id || retryPayload.taskId !== active.taskId)) return;
    storagePending.current = true;
    setIsStoragePending(true);
    setError("");
    setMessage("Capturing and accepting revision…");

    const sessionAtStart = active;
    let operationId = retryPayload?.operationId ?? crypto.randomUUID();
    let expectedTaskVersion = retryPayload?.expectedTaskVersion ?? sessionAtStart.taskVersion;
    let capturedDoc = retryPayload?.document;

    try {
      if (!capturedDoc) {
        capturedDoc = await captureActiveTask(sessionAtStart);
      }

      const result = await storage.acceptRevision({
        taskId: sessionAtStart.taskId,
        expectedTaskVersion,
        operationId,
        document: capturedDoc,
        name: `Task ${sessionAtStart.taskId.slice(0, 8)}`,
      });

      if (latest.current.active?.id === sessionAtStart.id) {
        setActive((cur) =>
          cur && cur.id === sessionAtStart.id
            ? {
                ...cur,
                taskVersion: result.metadata.taskVersion,
              }
            : cur,
        );
        setPendingRetryAcceptance(null);
        setMessage(
          result.isRetry
            ? `Accepted revision #${result.revision.revisionNumber} (idempotent retry)`
            : `Accepted revision #${result.revision.revisionNumber}`,
        );
        log(`Accepted revision #${result.revision.revisionNumber}`);
        void loadRevisionsForActiveTask(sessionAtStart.taskId, sessionAtStart.id);
      }
      void refreshSavedTasks();
    } catch (err) {
      if (latest.current.active?.id === sessionAtStart.id) {
        if (capturedDoc) {
          setPendingRetryAcceptance({
            generation: sessionAtStart.id,
            taskId: sessionAtStart.taskId,
            operationId,
            expectedTaskVersion,
            document: capturedDoc,
          });
        }
        if (err instanceof VersionConflictError) {
          setError(`Conflict accepting revision: expected version ${err.expected}, actual ${err.actual}`);
        } else if (err instanceof InvalidOperationError) {
          setError(`Invalid operation: ${err.message}`);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
        setMessage("Revision acceptance failed · working data preserved");
        log("Revision acceptance failed");
      }
    } finally {
      storagePending.current = false;
      setIsStoragePending(false);
    }
  };

  // Save & replace helper for navigation dialog
  const saveAndReplace = async () => {
    if (!active || !replacement || storagePending.current) return;
    storagePending.current = true;
    setIsStoragePending(true);
    setError("");
    setMessage("Saving draft before replacement…");

    const sessionAtStart = active;
    const replacementAtStart = replacement;

    try {
      const captured = await captureActiveTask(sessionAtStart);
      const result = await storage.saveDraft({
        taskId: sessionAtStart.taskId,
        expectedTaskVersion: sessionAtStart.taskVersion,
        document: captured,
        name: `Task ${sessionAtStart.taskId.slice(0, 8)}`,
      });
      void refreshSavedTasks();

      // If active session was replaced in between, do not touch UI
      if (latest.current.active?.id !== sessionAtStart.id) {
        return;
      }

      // Update old task's saved baseline in case candidate activation is cancelled or replacement modal was dismissed
      const serialized = JSON.stringify(captured.snapshot);
      setActive((cur) =>
        cur && cur.id === sessionAtStart.id
          ? {
              ...cur,
              taskVersion: result.taskVersion,
              currentDraftVersion: result.draftVersion,
              savedBaseline: serialized,
            }
          : cur,
      );

      // If modal was dismissed / cancelled (e.g. by Escape or user clicking cancel) while write was in flight
      if (currentReplacement.current !== replacementAtStart) {
        setMessage("Draft saved · replacement was cancelled");
        log(`Saved draft v${result.draftVersion}`);
        return;
      }

      // On success and replacement still active, proceed to activate replacement candidate
      activate(replacementAtStart.task, replacementAtStart.label, {
        taskId: replacementAtStart.taskId,
        taskVersion: replacementAtStart.taskVersion,
        currentDraftVersion: replacementAtStart.currentDraftVersion,
        savedBaseline: replacementAtStart.savedBaseline,
      });
    } catch (err) {
      if (latest.current.active?.id === sessionAtStart.id) {
        setError(
          err instanceof Error
            ? `Could not save before replacement: ${err.message}`
            : "Could not save before replacement.",
        );
        setMessage("Save failed · replacement remains pending; working data preserved");
        log("Save & replace aborted");
      }
    } finally {
      storagePending.current = false;
      setIsStoragePending(false);
    }
  };

  // Open/Restore saved task
  const openSavedTask = async (taskIdToOpen: string) => {
    if (!taskIdToOpen) return;
    await runPreparation(
      async (signal) => {
        const data = await storage.getTask(taskIdToOpen);
        if (!data) throw new Error("Saved task not found");
        let rawDoc: TaskDocument;
        let initialSavedBaseline: string | null = null;

        if (data.draft) {
          rawDoc = data.draft.document;
          initialSavedBaseline = JSON.stringify(data.draft.document.snapshot);
        } else if (data.latestRevision) {
          rawDoc = data.latestRevision.document;
          initialSavedBaseline = null; // Unsaved working draft
        } else {
          throw new StorageCorruptError("Corrupt saved task: no draft or accepted revision found");
        }

        signal.throwIfAborted();
        // Decode and verify image data through prepareTask
        const prepared = await prepareTask(rawDoc, signal);
        return {
          task: prepared,
          hostInfo: {
            taskId: data.metadata.taskId,
            taskVersion: data.metadata.taskVersion,
            currentDraftVersion: data.metadata.currentDraftVersion,
            savedBaseline: initialSavedBaseline,
          },
        };
      },
      `saved task ${taskIdToOpen.slice(0, 6)}`,
    );
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
      } else if (data.type === "CAPTURE_RESPONSE") {
        const handler = pendingCaptures.current.get(data.requestId);
        if (handler) {
          pendingCaptures.current.delete(data.requestId);
          if (handler.generation !== session.id) {
            handler.reject(new Error("Capture generation mismatch"));
            return;
          }
          if (data.success && data.task) {
            try {
              const validated = validateTask(data.task);
              const binding = parseConfiguration(validated.config);
              validateSnapshot(validated.snapshot, binding);
              handler.resolve(validated);
            } catch (e) {
              handler.reject(e instanceof Error ? e : new Error(String(e)));
            }
          } else {
            handler.reject(new Error(data.error || "Capture rejected by editor"));
          }
        }
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
        exportBaseline.current = JSON.stringify(data.snapshot);
        setMessage("Ready to annotate");
        setError("");
        copyOperation.current++;
        setCopyState("idle");
        setCopyError("");
        setPendingRetryAcceptance(null);
        setAcceptedRevisions([]);
        setInspectedRevision(null);
        for (const [reqId, handler] of pendingCaptures.current.entries()) {
          if (handler.generation !== session.id) {
            handler.reject(new Error("Frame replaced"));
            pendingCaptures.current.delete(reqId);
          }
        }
        void loadRevisionsForActiveTask(session.taskId, session.id);
        log("Ready · previous frame disposed");
      } else if (current?.id === session.id && ["CHANGE", "EXPORTED"].includes(data.type)) {
        setOutput(data);
        currentOutput.current = data;
        if (data.type === "EXPORTED") {
          setJson(JSON.stringify(data.snapshot, null, 2));
          exportBaseline.current = JSON.stringify(data.snapshot);
          setMessage("Snapshot exported below");
          log("Exported current result");
        }
      }
    };

    window.addEventListener("message", receive);
    return () => {
      request.current?.abort();
      window.removeEventListener("message", receive);
      for (const handler of pendingCaptures.current.values()) {
        handler.reject(new Error("Component unmounted"));
      }
      pendingCaptures.current.clear();
      storage.close();
    };
  }, [storage]);

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
    for (const handler of pendingCaptures.current.values()) {
      handler.reject(new Error("Frame disposed"));
    }
    pendingCaptures.current.clear();
    currentOutput.current = null;
    exportBaseline.current = "";
    latest.current = { active: null, candidate: null };
    setActive(null);
    setCandidate(null);
    setOutput(null);
    setAcceptedRevisions([]);
    setInspectedRevision(null);
    setPendingRetryAcceptance(null);
    setError("");
    copyOperation.current++;
    setCopyState("idle");
    setCopyError("");
    setMessage("Disposed · load a fixture to start again");
    log("Disposed all frames");
  };

  const busy = !!candidate || preparing || !!replacement || !active;
  const activeTask = active?.input ?? null;

  // Compute dirty status
  const currentSnapshotJson = output ? JSON.stringify(output.snapshot) : "";
  const isNeverSaved = (active?.currentDraftVersion ?? 0) === 0 && (active?.savedBaseline ?? null) === null;
  const isDraftDirty = isNeverSaved ? true : currentSnapshotJson !== active?.savedBaseline;

  const toggleDisclosure = (disclosure: Disclosure) =>
    setDisclosures((current) => ({ ...current, [disclosure]: !current[disclosure] }));

  const copyActiveConfiguration = async () => {
    if (!activeTask || copyState === "pending") return;
    const sessionId = active?.id;
    const operation = ++copyOperation.current;
    setCopyState("pending");
    setCopyError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(activeTask.config);
      if (latest.current.active?.id !== sessionId || copyOperation.current !== operation) return;
      setCopyState("success");
    } catch (copyFailure) {
      if (latest.current.active?.id !== sessionId || copyOperation.current !== operation) return;
      setCopyState("error");
      setCopyError(
        copyFailure instanceof Error
          ? `Could not copy active configuration: ${copyFailure.message}`
          : "Could not copy active configuration.",
      );
    }
  };

  return (
    <main className={`probe-app probe-mode-${displayMode} probe-theme-${theme}`}>
      <header className="probe-header">
        <div>
          <span className="probe-eyebrow">PLAYGROUND / COMPONENT LAB</span>
          <h1>Your data. Your labels.</h1>
          <p>Prepare a task, annotate it, and take the result with you.</p>
        </div>
        <div className="probe-header-actions">
          <div className="probe-mode-controls" aria-label="Display mode">
            {displayModes.map(({ mode, label }) => (
              <button key={mode} aria-pressed={displayMode === mode} onClick={() => setDisplayMode(mode)}>
                {label}
              </button>
            ))}
          </div>
          <button
            className="probe-theme-toggle"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          >
            Shell theme: {theme}
          </button>
          <a href="?">Open Playground ↗</a>
        </div>
      </header>

      {/* Host Lifecycle Management Bar */}
      <section className="probe-host-controls probe-full-only" aria-label="Host lifecycle">
        <div className="probe-host-row">
          <label>
            Durable task:
            <select
              value={selectedSavedTaskId}
              onChange={(e) => setSelectedSavedTaskId(e.target.value)}
              disabled={isStoragePending}
            >
              <option value="">Select a saved task…</option>
              {savedTasks.map((t) => (
                <option key={t.taskId} value={t.taskId}>
                  {t.name} ({t.taskId.slice(0, 6)}, v{t.taskVersion}) - {new Date(t.updatedAt).toLocaleTimeString()}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!selectedSavedTaskId || isStoragePending}
            onClick={() => void openSavedTask(selectedSavedTaskId)}
          >
            Open saved task
          </button>
          <button disabled={isStoragePending} onClick={() => void refreshSavedTasks()}>
            Refresh list
          </button>

          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              className={`probe-dirty-badge ${
                isNeverSaved ? "never-saved" : isDraftDirty ? "unsaved-changes" : "saved-current"
              }`}
            >
              {isNeverSaved ? "Never saved" : isDraftDirty ? "Unsaved changes" : "Saved draft current"}
            </span>
            <button disabled={busy || isStoragePending} onClick={() => void saveDraft()}>
              Save draft
            </button>
            <button disabled={busy || isStoragePending} onClick={() => void acceptRevision()}>
              Accept revision
            </button>
            {pendingRetryAcceptance && pendingRetryAcceptance.generation === active?.id && (
              <button
                disabled={busy || isStoragePending}
                style={{ background: "#92400e", color: "white" }}
                onClick={() => void acceptRevision(pendingRetryAcceptance)}
              >
                Retry acceptance
              </button>
            )}
          </span>
        </div>
      </section>

      <section className="probe-toolbar probe-full-only" aria-label="Session controls">
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
        <span className={candidate || isStoragePending ? "probe-dot busy" : "probe-dot"} />
        {message}
        <span>
          {active
            ? `Task ${active.taskId.slice(0, 6)} (v${active.taskVersion}, draft v${active.currentDraftVersion}) · Session ${active.id.slice(0, 8)}`
            : "No active session"}
        </span>
      </div>

      {error && (
        <div className="probe-error" role="alert">
          {error}
        </div>
      )}

      {copyState === "success" && (
        <div className="probe-copy-status" role="status">
          Active configuration copied.
        </div>
      )}
      {copyError && (
        <div className="probe-error" role="alert">
          {copyError}
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
          <p>
            Your current task has unsaved or unexported changes. A replacement starts fresh undo history and a new
            session.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "16px" }}>
            <button
              autoFocus
              disabled={isStoragePending}
              onClick={() => {
                void saveAndReplace();
              }}
            >
              Save &amp; replace
            </button>
            <button
              disabled={isStoragePending}
              onClick={() => {
                exportTask(true);
                activate(replacement.task, replacement.label, {
                  taskId: replacement.taskId,
                  taskVersion: replacement.taskVersion,
                  currentDraftVersion: replacement.currentDraftVersion,
                  savedBaseline: replacement.savedBaseline,
                });
              }}
            >
              Export &amp; replace
            </button>
            <button
              disabled={isStoragePending}
              onClick={() =>
                activate(replacement.task, replacement.label, {
                  taskId: replacement.taskId,
                  taskVersion: replacement.taskVersion,
                  currentDraftVersion: replacement.currentDraftVersion,
                  savedBaseline: replacement.savedBaseline,
                })
              }
            >
              Replace task
            </button>
            <button
              disabled={isStoragePending}
              onClick={() => {
                setReplacement(null);
                setMessage("Ready to annotate");
              }}
            >
              Keep editing
            </button>
          </div>
        </dialog>
      )}

      <section className="probe-disclosure probe-full-only" aria-label="Configuration controls">
        <div className="probe-disclosure-actions">
          <button
            className="probe-disclosure-trigger"
            aria-expanded={disclosures.configuration}
            aria-controls="probe-configuration"
            onClick={() => toggleDisclosure("configuration")}
          >
            {disclosures.configuration ? "Hide configuration" : "Show configuration"}
          </button>
          <button disabled={!activeTask || copyState === "pending"} onClick={() => void copyActiveConfiguration()}>
            {copyState === "pending" ? "Copying active XML…" : "Copy active XML"}
          </button>
        </div>
        <div id="probe-configuration" className="probe-disclosure-content" hidden={!disclosures.configuration}>
          <TaskPreparation
            task={active?.input ?? INITIAL_TASK}
            busy={!!candidate || preparing || !!replacement}
            onApply={applyDraft}
            onDraftChange={cancelPreparation}
          />
        </div>
      </section>

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
          <button
            className="probe-disclosure-trigger"
            aria-expanded={disclosures.inspection}
            aria-controls="probe-inspection"
            onClick={() => toggleDisclosure("inspection")}
          >
            {disclosures.inspection ? "Hide inspectors" : "Show inspectors"}
          </button>
          <div id="probe-inspection" className="probe-disclosure-content" hidden={!disclosures.inspection}>
            <section className="probe-inspector-section">
              <div className="probe-section-title">
                <h2>Accepted revisions</h2>
                <span>{acceptedRevisions.length} revision(s)</span>
              </div>
              <div style={{ padding: "10px 18px" }}>
                {acceptedRevisions.length === 0 ? (
                  <p style={{ fontSize: "12px", color: "#7a897e", margin: 0 }}>No accepted revisions for this task.</p>
                ) : (
                  <div className="probe-rev-list">
                    {acceptedRevisions.map((rev) => (
                      <div
                        key={rev.revisionId}
                        className={`probe-rev-item ${
                          inspectedRevision?.revisionId === rev.revisionId ? "selected" : ""
                        }`}
                        onClick={() => setInspectedRevision(rev)}
                      >
                        <div>
                          <strong>Revision #{rev.revisionNumber}</strong> ({rev.revisionId.slice(0, 8)})
                          <div style={{ fontSize: "11px", color: "#7a897e" }}>
                            {new Date(rev.acceptedAt).toLocaleTimeString()} · Task v{rev.taskVersion}
                          </div>
                        </div>
                        <button
                          style={{ fontSize: "11px", padding: "4px 8px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const text = JSON.stringify(rev.document, null, 2);
                            setJson(text);
                            setMessage(`Exported accepted revision #${rev.revisionNumber} below`);
                          }}
                        >
                          Export document
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {inspectedRevision && (
                <pre style={{ height: "140px", borderTop: "1px solid #e6eae5" }}>
                  {JSON.stringify(
                    {
                      revisionNumber: inspectedRevision.revisionNumber,
                      revisionId: inspectedRevision.revisionId,
                      acceptedAt: inspectedRevision.acceptedAt,
                      annotations: inspectedRevision.document.snapshot.annotations,
                    },
                    null,
                    2,
                  )}
                </pre>
              )}
            </section>

            <section className="probe-inspector-section">
              <div className="probe-section-title">
                <h2>Task input</h2>
                <span>Prepared input · read only</span>
              </div>
              <pre data-testid="probe-input">
                {activeTask ? JSON.stringify(inspectedTask(activeTask), null, 2) : "No prepared task yet."}
              </pre>
            </section>

            <section className="probe-inspector-section">
              <div className="probe-section-title">
                <h2>Result inspector</h2>
                <span>Current edited output · {output?.snapshot.annotations.length ?? 0} rectangles</span>
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
                {output
                  ? JSON.stringify(tab === "snapshot" ? output.snapshot : output.wire, null, 2)
                  : "No result yet."}
              </pre>
            </section>
          </div>
        </aside>
      </div>

      <div className="probe-bottom probe-full-only">
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
          <h2>Shell composition</h2>
          <p>
            The shell keeps task preparation, the isolated annotation session, and read-only input/output inspection in
            one workspace. Display modes and the shell theme change presentation only.
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
