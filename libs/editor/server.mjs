#!/usr/bin/env node
/**
 * Static file server for the editor production build.
 * Supports RFC 7233 byte ranges so media can report duration and seek.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicBasePath } from "../../tools/public-base-path.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "../../dist/libs/editor");
const STATIC_ROOT = path.resolve(process.env.STATIC_ROOT || DEFAULT_ROOT);
const PORT = Number(process.env.PORT) || 3000;
const BASE_PATH = publicBasePath();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function isInsideRoot(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function resolveFilePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;

  let candidate = path.join(STATIC_ROOT, ...(segments.length ? segments : ["index.html"]));
  if (!isInsideRoot(STATIC_ROOT, candidate) || !existsSync(candidate)) return null;

  if (statSync(candidate).isDirectory()) {
    candidate = path.join(candidate, "index.html");
  }

  return existsSync(candidate) ? candidate : null;
}

function parseSingleByteRange(rangeHeader, size) {
  if (!rangeHeader?.startsWith("bytes=")) return null;
  const [first] = rangeHeader.slice("bytes=".length).trim().split(",");
  const dash = first.indexOf("-");
  if (dash === -1) return null;

  const startText = first.slice(0, dash).trim();
  const endText = first.slice(dash + 1).trim();
  let start;
  let end;

  if (!startText) {
    const suffixLength = Number.parseInt(endText, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(startText, 10);
    if (!Number.isFinite(start) || start >= size) return "unsatisfiable";
    end = endText ? Math.min(Number.parseInt(endText, 10), size - 1) : size - 1;
    if (!Number.isFinite(end) || start > end) return "unsatisfiable";
  }

  return { start, end };
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (BASE_PATH !== "/" && url.pathname === BASE_PATH.slice(0, -1)) {
    res.writeHead(308, { Location: BASE_PATH + url.search });
    res.end();
    return;
  }
  const filePath = url.pathname.startsWith(BASE_PATH)
    ? resolveFilePath(url.pathname.slice(BASE_PATH.length))
    : null;
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const size = statSync(filePath).size;
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const range = parseSingleByteRange(req.headers.range, size);

  if (range === "unsatisfiable") {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    res.end();
    return;
  }

  const headers = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
  };
  if (range) {
    const { start, end } = range;
    res.writeHead(206, {
      ...headers,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
    });
    if (req.method === "GET") createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": size });
    if (req.method === "GET") createReadStream(filePath).pipe(res);
  }

  if (req.method === "HEAD") res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serving ${STATIC_ROOT} at http://0.0.0.0:${PORT}${BASE_PATH}`);
});
