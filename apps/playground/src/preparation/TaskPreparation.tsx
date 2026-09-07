import { useEffect, useRef, useState } from "react";
import { readImageFile, type TaskDocument } from "./task";

export type TaskDraft = { config: string; imageUrl: string; keep: boolean };
export function TaskPreparation({
  task,
  busy,
  onApply,
  onDraftChange,
}: {
  task: TaskDocument;
  busy: boolean;
  onApply: (draft: TaskDraft) => void;
  onDraftChange: () => void;
}) {
  const [config, setConfig] = useState(task.config);
  const [imageUrl, setImageUrl] = useState(task.imageUrl);
  const [keep, setKeep] = useState(true);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const fileRead = useRef<AbortController | null>(null);
  useEffect(() => {
    fileRead.current?.abort();
    setReading(false);
    setConfig(task.config);
    setImageUrl(task.imageUrl);
    setKeep(true);
    setFileName("");
    setFileError("");
    return () => fileRead.current?.abort();
  }, [task]);
  const dirty = config !== task.config || imageUrl !== task.imageUrl || !keep;
  return (
    <section className="task-preparation" aria-label="Configuration and source">
      <div className="probe-section-title">
        <h2>Prepare a task</h2>
        <span>{dirty ? "Draft changes · not applied" : "Matches active task"}</span>
      </div>
      <div className="task-fields">
        <div>
          <label htmlFor="task-config">Labeling configuration · XML</label>
          <textarea
            id="task-config"
            aria-label="Labeling configuration"
            spellCheck={false}
            value={config}
            onChange={(e) => {
              setConfig(e.target.value);
              onDraftChange();
            }}
          />
          <p>One Image, RectangleLabels, and your labels. Unrotated, single-label rectangles.</p>
        </div>
        <div>
          <label htmlFor="task-image-url">Image URL</label>
          <input
            id="task-image-url"
            aria-label="Image URL"
            value={imageUrl.startsWith("data:") ? "" : imageUrl}
            placeholder={
              imageUrl.startsWith("data:") ? "Embedded image ready · enter a URL to replace it" : "https://…"
            }
            onChange={(e) => {
              fileRead.current?.abort();
              setReading(false);
              setImageUrl(e.target.value);
              setFileName("");
              onDraftChange();
            }}
          />
          <label className="task-file" htmlFor="task-image-file">
            Or choose an image file (up to 15 MB)
          </label>
          <input
            id="task-image-file"
            aria-label="Image file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              onDraftChange();
              fileRead.current?.abort();
              const controller = new AbortController();
              fileRead.current = controller;
              setReading(true);
              setFileError("");
              try {
                const data = await readImageFile(file, controller.signal);
                if (!controller.signal.aborted) {
                  setImageUrl(data);
                  setFileName(file.name);
                  setKeep(false);
                }
              } catch (error) {
                if (!controller.signal.aborted) setFileError(String(error));
              } finally {
                if (!controller.signal.aborted) setReading(false);
              }
            }}
          />
          <p>
            {reading
              ? "Reading image…"
              : fileName ||
                (imageUrl.startsWith("data:")
                  ? "Image bytes are embedded in this task."
                  : "Remote images must allow browser access (CORS).")}
          </p>
          {fileError && <p role="alert">{fileError}</p>}
          <label htmlFor="task-results">Existing results</label>
          <select
            id="task-results"
            aria-label="Existing results"
            value={keep ? "keep" : "empty"}
            onChange={(e) => {
              setKeep(e.target.value === "keep");
              onDraftChange();
            }}
          >
            <option value="keep">Keep current rectangles (same image)</option>
            <option value="empty">Start with no rectangles</option>
          </select>
          <p>Removing a label used by an existing rectangle requires a new empty task or relabeling first.</p>
          <button disabled={busy || reading} onClick={() => onApply({ config, imageUrl, keep })}>
            Apply configuration &amp; image
          </button>
        </div>
      </div>
    </section>
  );
}
