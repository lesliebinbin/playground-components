import {
  validateStoredRecord,
  validateTaskMetadata,
  validateStoredDraft,
  validateStoredAcceptedRevision,
  canonicalTaskDocumentEqual,
  assertValidId,
  assertValidTaskVersion,
  VersionConflictError,
  InvalidOperationError,
  StorageCorruptError,
  StorageBlockedError,
} from "./storage";
import { DEFAULT_CONFIG } from "../preparation/configuration";
import { fixture } from "../probe/model";
import type { TaskDocument } from "../preparation/task";

const validDoc: TaskDocument = {
  format: "playground-task-v1",
  config: DEFAULT_CONFIG,
  imageUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==",
  snapshot: fixture("ai"),
};

describe("storage domain validation and record rules", () => {
  test("assertValidId and assertValidTaskVersion validate boundaries", () => {
    expect(() => assertValidId("task-123", "taskId")).not.toThrow();
    expect(() => assertValidId("invalid id with spaces!", "taskId")).toThrow(InvalidOperationError);
    expect(() => assertValidId("", "taskId")).toThrow(InvalidOperationError);

    expect(() => assertValidTaskVersion(0)).not.toThrow();
    expect(() => assertValidTaskVersion(5)).not.toThrow();
    expect(() => assertValidTaskVersion(-1)).toThrow(InvalidOperationError);
    expect(() => assertValidTaskVersion(1.5)).toThrow(InvalidOperationError);
  });

  test("validateStoredRecord rejects corrupt or invalid tasks", () => {
    expect(validateStoredRecord(validDoc)).toEqual(validDoc);
    expect(() => validateStoredRecord({ format: "unknown" })).toThrow(StorageCorruptError);
    expect(() => validateStoredRecord(null)).toThrow(StorageCorruptError);
  });

  test("validateTaskMetadata validates fields and catches corrupt states", () => {
    const raw = {
      schemaVersion: 1,
      taskId: "task-1",
      name: "Task 1",
      taskVersion: 1,
      currentDraftVersion: 1,
      revisionCount: 0,
      lastAcceptedRevisionId: null,
      createdAt: "2026-09-08T00:00:00Z",
      updatedAt: "2026-09-08T00:00:00Z",
    };
    expect(validateTaskMetadata(raw)).toEqual(raw);

    expect(() => validateTaskMetadata({ ...raw, schemaVersion: 2 })).toThrow(StorageCorruptError);
    expect(() => validateTaskMetadata({ ...raw, taskVersion: 0 })).toThrow(StorageCorruptError);
    expect(() => validateTaskMetadata({ ...raw, currentDraftVersion: -1 })).toThrow(StorageCorruptError);
    expect(() => validateTaskMetadata({ ...raw, lastAcceptedRevisionId: 123 })).toThrow(StorageCorruptError);
  });

  test("validateStoredDraft enforces taskId match and validates schema", () => {
    const raw = {
      schemaVersion: 1,
      taskId: "task-1",
      draftVersion: 1,
      taskVersion: 1,
      document: validDoc,
      savedAt: "2026-09-08T00:00:00Z",
    };
    expect(validateStoredDraft(raw, "task-1")).toBeDefined();
    expect(() => validateStoredDraft(raw, "task-2")).toThrow(StorageCorruptError);
    expect(() => validateStoredDraft({ ...raw, draftVersion: 0 })).toThrow(StorageCorruptError);
  });

  test("validateStoredAcceptedRevision enforces taskId and validates schema", () => {
    const raw = {
      schemaVersion: 1,
      revisionId: "rev-1",
      taskId: "task-1",
      revisionNumber: 1,
      operationId: "op-1",
      expectedTaskVersion: 0,
      taskVersion: 1,
      document: validDoc,
      acceptedAt: "2026-09-08T00:00:00Z",
    };
    expect(validateStoredAcceptedRevision(raw, "task-1")).toBeDefined();
    expect(() => validateStoredAcceptedRevision(raw, "task-2")).toThrow(StorageCorruptError);
    expect(() => validateStoredAcceptedRevision({ ...raw, revisionNumber: 0 })).toThrow(StorageCorruptError);
  });

  test("canonicalTaskDocumentEqual compares entire canonical TaskDocument", () => {
    const docA = structuredClone(validDoc);
    const docB = structuredClone(validDoc);
    expect(canonicalTaskDocumentEqual(docA, docB)).toBe(true);

    const docC = { ...docA, config: "<View></View>" };
    expect(canonicalTaskDocumentEqual(docA, docC)).toBe(false);

    const docD = { ...docA, imageUrl: "data:image/svg+xml;utf8,<svg>changed</svg>" };
    expect(canonicalTaskDocumentEqual(docA, docD)).toBe(false);

    const docE = {
      ...docA,
      snapshot: { ...docA.snapshot, annotations: [] },
    };
    expect(canonicalTaskDocumentEqual(docA, docE)).toBe(false);
  });

  test("error classes instantiate properly", () => {
    const vce = new VersionConflictError(1, 2);
    expect(vce.expected).toBe(1);
    expect(vce.actual).toBe(2);
    expect(vce.name).toBe("VersionConflictError");

    const ioe = new InvalidOperationError("test");
    expect(ioe.name).toBe("InvalidOperationError");

    const sce = new StorageCorruptError("test");
    expect(sce.name).toBe("StorageCorruptError");

    const sbe = new StorageBlockedError();
    expect(sbe.name).toBe("StorageBlockedError");
  });
});
