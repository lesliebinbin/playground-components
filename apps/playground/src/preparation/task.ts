import { validateSnapshot, type Snapshot } from "../probe/model";
import { parseConfiguration } from "./configuration";

export type TaskDocument = { format: "playground-task-v1"; config: string; imageUrl: string; snapshot: Snapshot };
const MAX_BYTES = 15 * 1024 * 1024;

export function validateTask(input: unknown): TaskDocument {
  const task = input as TaskDocument;
  if (!task || task.format !== "playground-task-v1") throw new Error("Expected a playground-task-v1 document.");
  const binding = parseConfiguration(task.config);
  if (typeof task.imageUrl !== "string" || !task.imageUrl.trim())
    throw new Error("An image is required. Choose a file, URL, or the explicit sample option.");
  const url = new URL(task.imageUrl, location.href);
  if (
    !["http:", "https:"].includes(url.protocol) &&
    !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(task.imageUrl)
  ) {
    throw new Error("Use an HTTP(S) image or an exported image data URL.");
  }
  if (task.imageUrl.length > MAX_BYTES * 1.5) throw new Error("Image data exceeds the 15 MB limit.");
  return {
    format: "playground-task-v1",
    config: task.config,
    imageUrl: url.href,
    snapshot: validateSnapshot(task.snapshot, binding),
  };
}

export function readImageFile(blob: Blob, signal?: AbortSignal): Promise<string> {
  if (!blob.type.startsWith("image/") || blob.size > MAX_BYTES)
    return Promise.reject(new Error("Choose an image file of at most 15 MB."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    reader.onload = () => {
      cleanup();
      resolve(String(reader.result));
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error("Could not read the image file."));
    };
    reader.onabort = cleanup;
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(blob);
  });
}

/** Fetch once, then freeze image bytes in a data URL so every frame decodes the same source. */
export async function prepareImage(input: string, signal: AbortSignal) {
  if (!input.trim()) throw new Error("An image is required. Sample mode is opt-in.");
  const url = new URL(input, location.href);
  if (!["http:", "https:"].includes(url.protocol) && !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(input))
    throw new Error("Unsupported image URL.");
  const response = await fetch(url.href, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Image exceeds the 15 MB limit.");
  const blob = await response.blob();
  const imageUrl = await readImageFile(blob, signal);
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Cancelled", "AbortError"));
    };
    image.onload = () => {
      cleanup();
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("The source could not be decoded as an image."));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    image.src = imageUrl;
  });
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 40_000_000)
    throw new Error("Use an image with at most 40 million pixels.");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  signal.throwIfAborted();
  const id = `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { imageUrl, source: { id, ...dimensions } };
}

export async function prepareTask(input: unknown, signal: AbortSignal): Promise<TaskDocument> {
  const task = validateTask(input);
  const image = await prepareImage(task.imageUrl, signal);
  if (image.source.width !== task.snapshot.source.width || image.source.height !== task.snapshot.source.height)
    throw new Error("Decoded image dimensions do not match the snapshot. The current task was retained.");
  if (task.snapshot.source.id.startsWith("sha256:") && task.snapshot.source.id !== image.source.id)
    throw new Error("Image content does not match the snapshot source identity.");
  return { ...task, imageUrl: image.imageUrl };
}
