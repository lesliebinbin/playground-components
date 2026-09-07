import { validateTask, type TaskDocument } from "../preparation/task";
import { parseConfiguration } from "../preparation/configuration";
import { validateSnapshot } from "../probe/model";

export const HOST_DB_NAME = "playground-host-v1";
export const HOST_DB_VERSION = 1;

export interface TaskMetadata {
  schemaVersion: 1;
  taskId: string;
  name: string;
  taskVersion: number;
  currentDraftVersion: number;
  revisionCount: number;
  lastAcceptedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredDraft {
  schemaVersion: 1;
  taskId: string;
  draftVersion: number;
  taskVersion: number;
  document: TaskDocument;
  savedAt: string;
}

export interface StoredAcceptedRevision {
  schemaVersion: 1;
  revisionId: string;
  taskId: string;
  revisionNumber: number;
  operationId: string;
  expectedTaskVersion: number;
  taskVersion: number;
  document: TaskDocument;
  acceptedAt: string;
}

export class VersionConflictError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`Version conflict: expected task version ${expected}, but found ${actual}`);
    this.name = "VersionConflictError";
  }
}

export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationError";
  }
}

export class StorageCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageCorruptError";
  }
}

export class StorageBlockedError extends Error {
  constructor(message = "IndexedDB database open request was blocked by another tab or connection") {
    super(message);
    this.name = "StorageBlockedError";
  }
}

export interface HostStorage {
  listTasks(): Promise<TaskMetadata[]>;
  getTask(taskId: string): Promise<{
    metadata: TaskMetadata;
    draft: StoredDraft | null;
    latestRevision: StoredAcceptedRevision | null;
  } | null>;
  saveDraft(params: {
    taskId: string;
    expectedTaskVersion: number;
    document: TaskDocument;
    name?: string;
  }): Promise<{ taskVersion: number; draftVersion: number; metadata: TaskMetadata }>;
  acceptRevision(params: {
    taskId: string;
    expectedTaskVersion: number;
    operationId: string;
    document: TaskDocument;
    name?: string;
  }): Promise<{ revision: StoredAcceptedRevision; metadata: TaskMetadata; isRetry: boolean }>;
  listAcceptedRevisions(taskId: string): Promise<StoredAcceptedRevision[]>;
  close(): void;
}

const UUID_OR_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export function assertValidId(id: string, label: string): void {
  if (typeof id !== "string" || !UUID_OR_ID_REGEX.test(id)) {
    throw new InvalidOperationError(`Invalid ${label}: must be a non-empty identifier up to 128 characters`);
  }
}

export function assertValidTaskVersion(version: number, label = "taskVersion"): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new InvalidOperationError(`Invalid ${label}: must be a non-negative integer`);
  }
}

export function validateStoredRecord(document: unknown): TaskDocument {
  try {
    const task = validateTask(document);
    const binding = parseConfiguration(task.config);
    validateSnapshot(task.snapshot, binding);
    return structuredClone(task);
  } catch (error) {
    throw new StorageCorruptError(
      error instanceof Error ? `Stored record validation failed: ${error.message}` : "Stored record validation failed",
    );
  }
}

export function validateTaskMetadata(raw: unknown): TaskMetadata {
  if (!raw || typeof raw !== "object") throw new StorageCorruptError("Task metadata is not an object");
  const m = raw as Partial<TaskMetadata>;
  if (m.schemaVersion !== 1) throw new StorageCorruptError(`Unsupported metadata schemaVersion: ${m.schemaVersion}`);
  if (typeof m.taskId !== "string" || !m.taskId) throw new StorageCorruptError("Task metadata missing taskId");
  if (typeof m.name !== "string") throw new StorageCorruptError("Task metadata missing name");
  if (!Number.isSafeInteger(m.taskVersion) || (m.taskVersion as number) < 1)
    throw new StorageCorruptError(`Invalid metadata taskVersion: ${m.taskVersion}`);
  if (!Number.isSafeInteger(m.currentDraftVersion) || (m.currentDraftVersion as number) < 0)
    throw new StorageCorruptError(`Invalid metadata currentDraftVersion: ${m.currentDraftVersion}`);
  if (!Number.isSafeInteger(m.revisionCount) || (m.revisionCount as number) < 0)
    throw new StorageCorruptError(`Invalid metadata revisionCount: ${m.revisionCount}`);
  if (m.lastAcceptedRevisionId !== null && typeof m.lastAcceptedRevisionId !== "string")
    throw new StorageCorruptError(`Invalid metadata lastAcceptedRevisionId: ${m.lastAcceptedRevisionId}`);
  if (typeof m.createdAt !== "string" || typeof m.updatedAt !== "string")
    throw new StorageCorruptError("Task metadata missing timestamps");
  return {
    schemaVersion: 1,
    taskId: m.taskId,
    name: m.name,
    taskVersion: m.taskVersion as number,
    currentDraftVersion: m.currentDraftVersion as number,
    revisionCount: m.revisionCount as number,
    lastAcceptedRevisionId: m.lastAcceptedRevisionId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export function validateStoredDraft(raw: unknown, expectedTaskId?: string): StoredDraft {
  if (!raw || typeof raw !== "object") throw new StorageCorruptError("Draft is not an object");
  const d = raw as Partial<StoredDraft>;
  if (d.schemaVersion !== 1) throw new StorageCorruptError(`Unsupported draft schemaVersion: ${d.schemaVersion}`);
  if (typeof d.taskId !== "string" || !d.taskId) throw new StorageCorruptError("Draft missing taskId");
  if (expectedTaskId && d.taskId !== expectedTaskId)
    throw new StorageCorruptError(`Draft taskId mismatch: expected ${expectedTaskId}, got ${d.taskId}`);
  if (!Number.isSafeInteger(d.draftVersion) || (d.draftVersion as number) < 1)
    throw new StorageCorruptError(`Invalid draftVersion: ${d.draftVersion}`);
  if (!Number.isSafeInteger(d.taskVersion) || (d.taskVersion as number) < 1)
    throw new StorageCorruptError(`Invalid taskVersion: ${d.taskVersion}`);
  if (typeof d.savedAt !== "string") throw new StorageCorruptError("Draft missing savedAt");
  const doc = validateStoredRecord(d.document);
  return {
    schemaVersion: 1,
    taskId: d.taskId,
    draftVersion: d.draftVersion as number,
    taskVersion: d.taskVersion as number,
    document: doc,
    savedAt: d.savedAt,
  };
}

export function validateStoredAcceptedRevision(raw: unknown, expectedTaskId?: string): StoredAcceptedRevision {
  if (!raw || typeof raw !== "object") throw new StorageCorruptError("Accepted revision is not an object");
  const r = raw as Partial<StoredAcceptedRevision>;
  if (r.schemaVersion !== 1) throw new StorageCorruptError(`Unsupported revision schemaVersion: ${r.schemaVersion}`);
  if (typeof r.revisionId !== "string" || !r.revisionId) throw new StorageCorruptError("Revision missing revisionId");
  if (typeof r.taskId !== "string" || !r.taskId) throw new StorageCorruptError("Revision missing taskId");
  if (expectedTaskId && r.taskId !== expectedTaskId)
    throw new StorageCorruptError(`Revision taskId mismatch: expected ${expectedTaskId}, got ${r.taskId}`);
  if (!Number.isSafeInteger(r.revisionNumber) || (r.revisionNumber as number) < 1)
    throw new StorageCorruptError(`Invalid revisionNumber: ${r.revisionNumber}`);
  if (typeof r.operationId !== "string" || !r.operationId)
    throw new StorageCorruptError("Revision missing operationId");
  if (!Number.isSafeInteger(r.expectedTaskVersion) || (r.expectedTaskVersion as number) < 0)
    throw new StorageCorruptError(`Invalid expectedTaskVersion: ${r.expectedTaskVersion}`);
  if (!Number.isSafeInteger(r.taskVersion) || (r.taskVersion as number) < 1)
    throw new StorageCorruptError(`Invalid taskVersion: ${r.taskVersion}`);
  if (typeof r.acceptedAt !== "string") throw new StorageCorruptError("Revision missing acceptedAt");
  const doc = validateStoredRecord(r.document);
  return {
    schemaVersion: 1,
    revisionId: r.revisionId,
    taskId: r.taskId,
    revisionNumber: r.revisionNumber as number,
    operationId: r.operationId,
    expectedTaskVersion: r.expectedTaskVersion as number,
    taskVersion: r.taskVersion as number,
    document: doc,
    acceptedAt: r.acceptedAt,
  };
}

export function canonicalTaskDocumentEqual(a: TaskDocument, b: TaskDocument): boolean {
  if (a.format !== b.format || a.config !== b.config || a.imageUrl !== b.imageUrl) return false;
  return JSON.stringify(a.snapshot) === JSON.stringify(b.snapshot);
}

export class IndexedDbHostStorage implements HostStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private pendingOpenReject: ((err: Error) => void) | null = null;
  private isClosed = false;

  constructor(private readonly dbName: string = HOST_DB_NAME) {}

  private getDb(): Promise<IDBDatabase> {
    if (this.isClosed) return Promise.reject(new Error("Storage has been closed"));
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is not available in this environment"));
    }
    if (this.dbPromise) return this.dbPromise;

    let pendingReject: ((err: Error) => void) | null = null;
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      pendingReject = (err: Error) => {
        if (!settled) {
          settled = true;
          this.pendingOpenReject = null;
          this.dbPromise = null;
          reject(err);
        }
      };

      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          this.pendingOpenReject = null;
          this.dbPromise = null;
          reject(err);
        }
      };

      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(this.dbName, HOST_DB_VERSION);
      } catch (e) {
        fail(e);
        return;
      }

      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains("tasks")) {
            db.createObjectStore("tasks", { keyPath: "taskId" });
          }
          if (!db.objectStoreNames.contains("drafts")) {
            db.createObjectStore("drafts", { keyPath: "taskId" });
          }
          if (!db.objectStoreNames.contains("accepted_revisions")) {
            const revStore = db.createObjectStore("accepted_revisions", { keyPath: "revisionId" });
            revStore.createIndex("taskId", "taskId", { unique: false });
            revStore.createIndex("operationId", "operationId", { unique: true });
          }
        } catch (e) {
          fail(e);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        if (this.isClosed || settled) {
          try {
            db.close();
          } catch {}
          return;
        }
        db.onversionchange = () => {
          try {
            db.close();
          } catch {}
          this.dbPromise = null;
          this.isClosed = true;
        };
        settled = true;
        this.pendingOpenReject = null;
        resolve(db);
      };

      request.onerror = () => {
        fail(request.error ?? new Error("Could not open IndexedDB database"));
      };

      request.onblocked = () => {
        fail(new StorageBlockedError(`IndexedDB open blocked for ${this.dbName}`));
      };
    });

    this.pendingOpenReject = pendingReject;
    const trackedPromise = promise.catch((err) => {
      if (this.dbPromise === trackedPromise) {
        this.dbPromise = null;
      }
      throw err;
    });
    this.dbPromise = trackedPromise;
    return this.dbPromise;
  }

  async listTasks(): Promise<TaskMetadata[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      try {
        const tx = db.transaction("tasks", "readonly");
        tx.onerror = () => fail(tx.error ?? new Error("Transaction error while listing tasks"));
        tx.onabort = () => fail(tx.error ?? new Error("Transaction aborted while listing tasks"));

        const store = tx.objectStore("tasks");
        const req = store.getAll();
        req.onsuccess = () => {
          try {
            const tasks = (req.result as unknown[]).map((t) => validateTaskMetadata(t));
            tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            if (!settled) {
              settled = true;
              resolve(tasks);
            }
          } catch (e) {
            fail(e);
          }
        };
        req.onerror = () => fail(req.error ?? new Error("Failed to list tasks"));
      } catch (e) {
        fail(e);
      }
    });
  }

  async getTask(taskId: string): Promise<{
    metadata: TaskMetadata;
    draft: StoredDraft | null;
    latestRevision: StoredAcceptedRevision | null;
  } | null> {
    assertValidId(taskId, "taskId");
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      try {
        const tx = db.transaction(["tasks", "drafts", "accepted_revisions"], "readonly");
        tx.onerror = () => fail(tx.error ?? new Error("Transaction error while getting task"));
        tx.onabort = () => fail(tx.error ?? new Error("Transaction aborted while getting task"));

        const tasksStore = tx.objectStore("tasks");
        const draftsStore = tx.objectStore("drafts");
        const revStore = tx.objectStore("accepted_revisions");

        const taskReq = tasksStore.get(taskId);
        taskReq.onsuccess = () => {
          try {
            if (!taskReq.result) {
              if (!settled) {
                settled = true;
                resolve(null);
              }
              return;
            }
            const metadata = validateTaskMetadata(taskReq.result);

            const draftReq = draftsStore.get(taskId);
            draftReq.onsuccess = () => {
              try {
                let draft: StoredDraft | null = null;
                if (draftReq.result) {
                  draft = validateStoredDraft(draftReq.result, taskId);
                  if (draft.draftVersion !== metadata.currentDraftVersion) {
                    fail(
                      new StorageCorruptError(
                        `Draft version ${draft.draftVersion} does not match metadata currentDraftVersion ${metadata.currentDraftVersion}`,
                      ),
                    );
                    return;
                  }
                } else if (metadata.currentDraftVersion > 0) {
                  fail(
                    new StorageCorruptError(
                      `Task ${taskId} specifies currentDraftVersion ${metadata.currentDraftVersion} but draft record is missing`,
                    ),
                  );
                  return;
                }

                if (metadata.lastAcceptedRevisionId) {
                  const revReq = revStore.get(metadata.lastAcceptedRevisionId);
                  revReq.onsuccess = () => {
                    try {
                      if (!revReq.result) {
                        fail(
                          new StorageCorruptError(
                            `Task ${taskId} references missing revision ${metadata.lastAcceptedRevisionId}`,
                          ),
                        );
                        return;
                      }
                      const latestRevision = validateStoredAcceptedRevision(revReq.result, taskId);
                      if (!settled) {
                        settled = true;
                        resolve({ metadata, draft, latestRevision });
                      }
                    } catch (e) {
                      fail(e);
                    }
                  };
                  revReq.onerror = () => fail(revReq.error ?? new Error("Failed to read revision"));
                } else {
                  if (!settled) {
                    settled = true;
                    resolve({ metadata, draft, latestRevision: null });
                  }
                }
              } catch (e) {
                fail(e);
              }
            };
            draftReq.onerror = () => fail(draftReq.error ?? new Error("Failed to read draft"));
          } catch (e) {
            fail(e);
          }
        };
        taskReq.onerror = () => fail(taskReq.error ?? new Error("Failed to read task"));
      } catch (e) {
        fail(e);
      }
    });
  }

  async saveDraft({
    taskId,
    expectedTaskVersion,
    document,
    name,
  }: {
    taskId: string;
    expectedTaskVersion: number;
    document: TaskDocument;
    name?: string;
  }): Promise<{ taskVersion: number; draftVersion: number; metadata: TaskMetadata }> {
    assertValidId(taskId, "taskId");
    assertValidTaskVersion(expectedTaskVersion, "expectedTaskVersion");
    const validatedDoc = validateStoredRecord(document);
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      try {
        const tx = db.transaction(["tasks", "drafts"], "readwrite");
        let nextTaskVersion = 1;
        let nextDraftVersion = 1;
        let resultMeta: TaskMetadata;

        tx.onabort = () => fail(tx.error ?? new Error("Save draft transaction aborted"));
        tx.onerror = () => fail(tx.error ?? new Error("Save draft transaction failed"));
        tx.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve({
              taskVersion: nextTaskVersion,
              draftVersion: nextDraftVersion,
              metadata: structuredClone(resultMeta),
            });
          }
        };

        const tasksStore = tx.objectStore("tasks");
        const draftsStore = tx.objectStore("drafts");

        const getReq = tasksStore.get(taskId);
        getReq.onsuccess = () => {
          try {
            const rawMeta = getReq.result;
            const now = new Date().toISOString();

            if (rawMeta) {
              const existing = validateTaskMetadata(rawMeta);
              if (existing.taskVersion !== expectedTaskVersion) {
                fail(new VersionConflictError(expectedTaskVersion, existing.taskVersion));
                try {
                  tx.abort();
                } catch {}
                return;
              }
              nextTaskVersion = existing.taskVersion + 1;
              nextDraftVersion = existing.currentDraftVersion + 1;
              resultMeta = {
                ...existing,
                name: name ? String(name).slice(0, 100) : existing.name,
                taskVersion: nextTaskVersion,
                currentDraftVersion: nextDraftVersion,
                updatedAt: now,
              };
              tasksStore.put(resultMeta);
            } else {
              if (expectedTaskVersion !== 0) {
                fail(new VersionConflictError(expectedTaskVersion, 0));
                try {
                  tx.abort();
                } catch {}
                return;
              }
              nextTaskVersion = 1;
              nextDraftVersion = 1;
              resultMeta = {
                schemaVersion: 1,
                taskId,
                name: name ? String(name).slice(0, 100) : "Saved task",
                taskVersion: 1,
                currentDraftVersion: 1,
                revisionCount: 0,
                lastAcceptedRevisionId: null,
                createdAt: now,
                updatedAt: now,
              };
              tasksStore.add(resultMeta);
            }

            const draftRecord: StoredDraft = {
              schemaVersion: 1,
              taskId,
              draftVersion: nextDraftVersion,
              taskVersion: nextTaskVersion,
              document: validatedDoc,
              savedAt: now,
            };
            draftsStore.put(draftRecord);
          } catch (e) {
            fail(e);
            try {
              tx.abort();
            } catch {}
          }
        };
        getReq.onerror = () => {
          fail(getReq.error ?? new Error("Failed to read task"));
          try {
            tx.abort();
          } catch {}
        };
      } catch (e) {
        fail(e);
      }
    });
  }

  async acceptRevision({
    taskId,
    expectedTaskVersion,
    operationId,
    document,
    name,
  }: {
    taskId: string;
    expectedTaskVersion: number;
    operationId: string;
    document: TaskDocument;
    name?: string;
  }): Promise<{ revision: StoredAcceptedRevision; metadata: TaskMetadata; isRetry: boolean }> {
    assertValidId(taskId, "taskId");
    assertValidTaskVersion(expectedTaskVersion, "expectedTaskVersion");
    assertValidId(operationId, "operationId");
    const validatedDoc = validateStoredRecord(document);
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      try {
        const tx = db.transaction(["tasks", "accepted_revisions"], "readwrite");
        let resultRevision: StoredAcceptedRevision;
        let resultMeta: TaskMetadata;
        let isRetry = false;

        tx.onabort = () => fail(tx.error ?? new Error("Accept revision transaction aborted"));
        tx.onerror = () => fail(tx.error ?? new Error("Accept revision transaction failed"));
        tx.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve({
              revision: structuredClone(resultRevision),
              metadata: structuredClone(resultMeta),
              isRetry,
            });
          }
        };

        const revStore = tx.objectStore("accepted_revisions");
        const tasksStore = tx.objectStore("tasks");
        const opIndex = revStore.index("operationId");

        const opReq = opIndex.get(operationId);
        opReq.onsuccess = () => {
          try {
            if (opReq.result) {
              const existingOp = validateStoredAcceptedRevision(opReq.result);
              if (existingOp.taskId !== taskId) {
                fail(new InvalidOperationError(`Operation ID ${operationId} belongs to task ${existingOp.taskId}`));
                try {
                  tx.abort();
                } catch {}
                return;
              }
              if (!canonicalTaskDocumentEqual(existingOp.document, validatedDoc)) {
                fail(new InvalidOperationError(`Operation ID ${operationId} reuse with different payload`));
                try {
                  tx.abort();
                } catch {}
                return;
              }

              isRetry = true;
              resultRevision = existingOp;
              const taskReq = tasksStore.get(taskId);
              taskReq.onsuccess = () => {
                try {
                  if (!taskReq.result) {
                    fail(new StorageCorruptError(`Task ${taskId} missing for existing operation ${operationId}`));
                    try {
                      tx.abort();
                    } catch {}
                    return;
                  }
                  resultMeta = validateTaskMetadata(taskReq.result);
                } catch (e) {
                  fail(e);
                  try {
                    tx.abort();
                  } catch {}
                }
              };
              taskReq.onerror = () => {
                fail(taskReq.error ?? new Error("Failed to read task"));
                try {
                  tx.abort();
                } catch {}
              };
              return;
            }

            const taskReq = tasksStore.get(taskId);
            taskReq.onsuccess = () => {
              try {
                const now = new Date().toISOString();
                const revisionId = crypto.randomUUID();
                let nextTaskVersion = 1;
                let nextRevNumber = 1;

                if (taskReq.result) {
                  const existingTask = validateTaskMetadata(taskReq.result);
                  if (existingTask.taskVersion !== expectedTaskVersion) {
                    fail(new VersionConflictError(expectedTaskVersion, existingTask.taskVersion));
                    try {
                      tx.abort();
                    } catch {}
                    return;
                  }
                  nextTaskVersion = existingTask.taskVersion + 1;
                  nextRevNumber = existingTask.revisionCount + 1;
                  resultMeta = {
                    ...existingTask,
                    name: name ? String(name).slice(0, 100) : existingTask.name,
                    taskVersion: nextTaskVersion,
                    revisionCount: nextRevNumber,
                    lastAcceptedRevisionId: revisionId,
                    updatedAt: now,
                  };
                  tasksStore.put(resultMeta);
                } else {
                  if (expectedTaskVersion !== 0) {
                    fail(new VersionConflictError(expectedTaskVersion, 0));
                    try {
                      tx.abort();
                    } catch {}
                    return;
                  }
                  nextTaskVersion = 1;
                  nextRevNumber = 1;
                  resultMeta = {
                    schemaVersion: 1,
                    taskId,
                    name: name ? String(name).slice(0, 100) : "Accepted task",
                    taskVersion: 1,
                    currentDraftVersion: 0,
                    revisionCount: 1,
                    lastAcceptedRevisionId: revisionId,
                    createdAt: now,
                    updatedAt: now,
                  };
                  tasksStore.add(resultMeta);
                }

                resultRevision = {
                  schemaVersion: 1,
                  revisionId,
                  taskId,
                  revisionNumber: nextRevNumber,
                  operationId,
                  expectedTaskVersion,
                  taskVersion: nextTaskVersion,
                  document: validatedDoc,
                  acceptedAt: now,
                };
                revStore.add(resultRevision);
              } catch (e) {
                fail(e);
                try {
                  tx.abort();
                } catch {}
              }
            };
            taskReq.onerror = () => {
              fail(taskReq.error ?? new Error("Failed to read task"));
              try {
                tx.abort();
              } catch {}
            };
          } catch (e) {
            fail(e);
            try {
              tx.abort();
            } catch {}
          }
        };
        opReq.onerror = () => {
          fail(opReq.error ?? new Error("Failed to check operation ID"));
          try {
            tx.abort();
          } catch {}
        };
      } catch (e) {
        fail(e);
      }
    });
  }

  async listAcceptedRevisions(taskId: string): Promise<StoredAcceptedRevision[]> {
    assertValidId(taskId, "taskId");
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      try {
        const tx = db.transaction("accepted_revisions", "readonly");
        tx.onerror = () => fail(tx.error ?? new Error("Transaction error while listing revisions"));
        tx.onabort = () => fail(tx.error ?? new Error("Transaction aborted while listing revisions"));

        const revStore = tx.objectStore("accepted_revisions");
        const index = revStore.index("taskId");
        const req = index.getAll(taskId);
        req.onsuccess = () => {
          try {
            const revs = (req.result as unknown[]).map((r) => validateStoredAcceptedRevision(r, taskId));
            revs.sort((a, b) => b.revisionNumber - a.revisionNumber);
            if (!settled) {
              settled = true;
              resolve(revs);
            }
          } catch (e) {
            fail(e);
          }
        };
        req.onerror = () => fail(req.error ?? new Error("Failed to list revisions"));
      } catch (e) {
        fail(e);
      }
    });
  }

  close(): void {
    this.isClosed = true;
    if (this.pendingOpenReject) {
      this.pendingOpenReject(new Error("Storage has been closed"));
      this.pendingOpenReject = null;
    }
    if (this.dbPromise) {
      this.dbPromise
        .then((db) => {
          try {
            db.close();
          } catch {}
        })
        .catch(() => {});
      this.dbPromise = null;
    }
  }
}
