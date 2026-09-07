# Playground components

Four conceptual responsibilities assembled in one runnable application:

1. **Annotation editing:** an isolated session around the existing Label Studio
   editor, with rectangle import/export and observable history.
2. **Configuration and task preparation:** XML validation, configurable labels and
   bindings, source-image loading, and complete task export/import.
3. **Application composition shell:** display modes, shell theme, stable
   configuration/input/output inspection, and session controls around the editor.
4. **Host lifecycle and browser-local persistence:** browser-local durable drafts,
   atomic compare-and-swap (CAS) task versioning in IndexedDB, explicit immutable
   accepted revisions with idempotent retry, gesture rejection guards, and safe
   multi-task switching.

Application code stays in `apps/playground`. Existing editor/shared libraries and
root tooling are unchanged. The repository was copied locally from frontend
revision `22597647c763078d6037c56db9464bcedcadd084`; it was initially published as
`playground-component-probe` and is now `lesliebinbin/playground-components`.

## Run and validate

From the repository root, using Node 24 and npm:

```sh
npm ci
npm run playground:build
PORT=4201 STATIC_ROOT=dist/apps/playground node libs/editor/server.mjs
```

Open [the components app](http://localhost:4201/?component-probe=1). The original
Playground still opens at `/`. The query name is retained for compatibility with
the first component. Set `mode=all`, `mode=preview`, or `mode=preview-inline` to
choose an initial shell display mode; an unknown value uses full mode. Presentation
and disclosure preferences are in memory and reset on reload. For development use
`npm run playground:serve` on port 4200.

```sh
npm run test:unit -- --runInBand apps/playground
# While the built app is served above:
node apps/playground/probe-browser-check.mjs
node apps/playground/host-storage-browser-check.mjs
node apps/playground/host-browser-check.mjs
```

The browser checks use installed Google Chrome and temporary user profiles, with no
new npm dependencies. Override `CHROME_BIN`, `PROBE_URL`, `PROBE_SCREENSHOT`, and
`HOST_SCREENSHOT` as necessary. They validate real pointer drawing, configuration/source tests,
independent IndexedDB CAS/rollback rules, and comprehensive host lifecycle interactions.

## Review the new module

### Host lifecycle and durable persistence walkthrough

1. **Save draft:** Start with the AI fixture. Click **Save draft**. The status badge
   transitions from `Never saved` to `Saved draft current` (e.g. `Task [id] (v1, draft v1)`).
2. **Edit and dirty state:** Move or resize a rectangle. The badge immediately indicates
   `Unsaved changes`.
3. **Accept revision:** Click **Accept revision**. The revision is committed as an immutable
   record (e.g. `Accepted revision #1`). Acceptance increments the shared `taskVersion` but
   does **not** mark the working draft as clean; the draft badge remains `Unsaved changes`
   because acceptance is not save.
4. **Immutability of accepted revisions:** Further edit or undo annotations, or save a new
   draft. Use the Accepted revisions section in the inspectors: past accepted
   revisions remain identical and immutable, and can be inspected or downloaded as portable
   complete tasks at any time.
5. **Reload and restore:** Reload the browser. The active working session resets, but all
   durable tasks survive in IndexedDB. Select your saved task from the dropdown and click
   **Open saved task**. The working state and baseline restore faithfully.
6. **Accepted-only task restore:** If an accepted task had no draft saved (or only accepted
   revisions), reopening it restores its latest accepted revision as an active **Never saved**
   working draft (with no durable saved baseline), preserving the distinction between draft
   and revision history.
7. **Save & replace navigation:** With unsaved edits on an active task, click **Load human fixture**
   (or apply new XML/image). The replacement dialog offers **Save & replace**, **Replace task**,
   **Export & replace**, or **Keep editing** (or pressing `Escape`). Clicking **Save & replace**
   commits the draft to IndexedDB before switching to the candidate. If saving fails (e.g. CAS
   conflict or quota failure), the candidate is blocked and working data is kept intact.
8. **Idempotent retry:** If an acceptance acknowledgment is lost or transiently fails, clicking
   **Retry acceptance** uses the original preserved operation ID and payload. If the original
   write committed, it returns the existing revision without advancing the task version;
   otherwise it attempts that original capture with the same expected version.

### Configuration and editing review

1. Start with the AI sample, then edit the XML to add a label:
   `<Label value="Tree" background="#50774a" />` inside `RectangleLabels`.
2. Click **Apply configuration & image** with **Keep current rectangles** selected.
   Existing annotations should remain, and Tree should become available.
3. Try malformed XML, an unsupported tag, or removing a label still used by a
   rectangle. Preparation should fail with the active editor/history intact.
4. Choose your own image file, which selects **Start with no rectangles**. Apply
   it, choose a label, and draw. You can also use an HTTP(S) image URL that permits
   browser access via CORS. Supported image input is at most 15 MB / 40 million pixels.
5. Use **Export task**. This places configuration, embedded image bytes, and the
   annotation snapshot in the JSON area. Copy it, reload the page, paste it, and
   click **Load snapshot**. The whole task should reopen independently.
6. Edit an annotation, then request a replacement. **Keep editing** cancels;
   **Replace task** proceeds; **Export & replace** downloads the current complete
   task before replacement. A replacement resets local undo history.
7. Use the header to choose **Full mode**, **Preview**, or **Preview inline**.
   Full mode restores preparation, fixture, import/export, and inspector controls.
   The configuration and inspector disclosures retain their state and any
   unapplied XML/source draft while hidden. **Copy active XML** always copies the
   prepared active task, not an unapplied draft, and reports clipboard failures.
   **Shell theme** changes only this surrounding application shell.

The **Task input** inspector shows the prepared task that initialized the active
editor. The **Result inspector** shows the current edited output. Embedded image
data is summarized in Task input to avoid rendering large base64 bytes there; full
task export keeps it unchanged.

The fixture buttons are explicit sample selection. A missing or failed user image
never falls back to a sample. Image loading and decoding complete before activation;
older requests are cancelled when superseded or when the draft is edited.

## Contracts and format

The preparation module accepts a deliberately small XML vocabulary: one `View`,
one `Image`, one `RectangleLabels`, and 1–50 unique labels. Image/control names and
the `$dataKey` binding can vary. `canRotate="false"` is required; multiple-label
rectangles, arbitrary attributes, and other modalities produce diagnostics.
The original Playground continues to expose its existing broader XML behavior.

A complete task uses:

```text
{ format: "playground-task-v1", config: XML,
  imageUrl: embedded image data URL,
  snapshot: { schemaVersion: 1, source: { id, width, height }, annotations: [...] } }
```

New image IDs use SHA-256 of the loaded bytes. On import, hash-based source identity
and dimensions are checked before installing the task. Legacy fixture source IDs
remain supported; those IDs alone do not prove content identity.

The snapshot retains structured rectangles in intrinsic image coordinates.
Conversion uses each source's dimensions and configuration bindings, preserving
supported identity, label, metadata, and fixture provenance fields. A bare snapshot
can still be exported/loaded, but it must match the active image and configuration.
Use a complete task for portable transfer to a different session or browser.

Source resolution/configuration and durable persistence are host responsibilities.
The annotation frame receives a validated task and remains the single authoritative
editing engine. The parent retains exported values for inspection, never a competing
editable store.

## Host lifecycle and persistence semantics

- **Native IndexedDB (`playground-host-v1`):** No external dependencies. Stores tasks,
  drafts, and immutable accepted revisions in dedicated object stores.
- **Monotonic taskVersion CAS:** Both draft saves and revision acceptances increment
  a shared `taskVersion` under transaction-scoped compare-and-swap checks on
  `expectedTaskVersion`. A concurrent write from another tab or window fails with
  `VersionConflictError`, leaving local unsaved edits intact. Users can refresh the
  saved task list and reopen; the replacement dialog protects unsaved edits.
  Export edits before choosing to discard them if a separate copy is needed.
- **Draft versioning:** `draftVersion` increments only on explicit draft saves.
- **Detached immutable revisions:** Accepted revisions freeze a snapshot correlated
  with the editor frame. Retrying an acceptance with the same operation ID returns
  the existing revision without advancing the task version, even if subsequent
  versions have advanced. Reusing an operation ID with different configuration, image,
  or annotations is strictly rejected.
- **Gesture rejection guard:** Attempting to capture while a pointer is pressed, a
  drawing tool is active, or a transform is in progress is conservatively rejected by
  the frame (`GESTURE_ACTIVE`), preventing corrupt history or transient shapes from
  being persisted.
- **Local browser limits:** Storage is browser-local. User clearing of browser site data,
  private browsing modes, or storage quota exhaustion will affect or reject writes;
  quota failures cleanly roll back metadata and notify the user while preserving the
  live working draft. There is no remote backend, submission queue, or ComfyUI sync.
  Task exports are portable across browsers/devices, but export is neither a save nor
  an acceptance.

## Files

- `src/host/storage.ts`: native IndexedDB host storage adapter, CAS transactions,
  record validation, and error types.
- `src/host/storage.test.ts`: storage schema, validation, and domain rule unit tests.
- `src/preparation/configuration.ts`: supported XML parser and diagnostics.
- `src/preparation/task.ts`: task validation, image resolution, identity, decode.
- `src/preparation/TaskPreparation.tsx`: editable draft configuration/source form.
- `src/probe/model.ts`: general rectangle snapshot/wire conversion.
- `src/probe/ProbeApp.tsx`: assembly, cancellation, disposition, import/export, host
  lifecycle toolbar, and revision inspection.
- `src/probe/ProbeFrame.tsx`: isolated existing-editor session, gesture inspection,
  and correlated capture RPC.
- `host-storage-browser-check.mjs`: real browser IndexedDB test suite verifying 19
  CAS, concurrency, rollback, corruption, and retry rules.
- `host-browser-check.mjs`: end-to-end browser check verifying real UI interactions,
  pointer gesture rejection, delayed writes, lost-ack retry, and mobile responsiveness.

## Validation and limits

Implemented through ACP with architect review on 2026-09-08 by Gemini 3.8 Flash,
with independent review and verification. All 109 Playground unit tests and the
production build passed. Full browser suites passed in real headless Chrome:

- `probe-browser-check.mjs`: core editor lifecycle, configuration switching, rectangle
  creation with real CDP pointer events, undo/redo, and replacement flows.
- `host-storage-browser-check.mjs`: 19 independent assertions verifying native IndexedDB
  adapter behavior, detached capture before open, CAS stale write rejection, 2-connection
  CAS winner, acceptance version advancement, idempotent retry, immutable revision
  content, missing declared draft rejection, corrupt record rejection, close-during-open
  rejection, and transient opening failure retry.
- `host-browser-check.mjs`: UI-driven lifecycle validation covering save/edit/export/accept,
  reload, restore, modal Save & replace, confirmed restore baseline preservation,
  delayed save acknowledgements, lost-ack retry with dirty edits, stale old-session write isolation,
  pointer drawing gesture rejection followed by completion, Escape during Save & replace,
  storage quota rollback, accepted-only task restore, and 390px mobile viewports.

The inherited Biome configuration is incompatible with the locally installed CLI;
changed files were formatted with an isolated configuration. Root lint and full
repository test/build coverage are not claimed. Production bundle-size warnings remain.

This is an image-rectangle slice. There is no remote backend synchronization,
external workflow dispatch, ComfyUI integration, configuration sharing, or broader
modality support. Exporting is not acceptance. Preview inline is a compact shell
presentation; it does not assert parity with the baseline editor's internal
bottom-panel behavior. Shell theme intentionally does not theme the embedded
editor. Native editor bounds adjustment, hit-testing, automatic gesture cancellation,
and arbitrary actor history remain compatibility limits from the first component.
Keyboard completeness, all image formats, remote XML configuration, and full
Playground parity are not certified by this module. See [the original probe guide](COMPONENT_PROBE.md)
for historical first-component validation details.
