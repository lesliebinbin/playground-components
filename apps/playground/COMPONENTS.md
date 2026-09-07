# Playground components

Two conceptual responsibilities assembled in one runnable application:

1. **Annotation editing:** an isolated session around the existing Label Studio
   editor, with rectangle import/export and observable history.
2. **Configuration and task preparation:** XML validation, configurable labels and
   bindings, source-image loading, and complete task export/import.

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
the first component. For development use `npm run playground:serve` on port 4200.

```sh
npm run test:unit -- --runInBand apps/playground
# While the built app is served above:
node apps/playground/probe-browser-check.mjs
```

The browser check uses installed Google Chrome and a temporary profile, with no
new npm dependencies. Override `CHROME_BIN`, `PROBE_URL`, and `PROBE_SCREENSHOT`
as necessary. It runs real pointer drawing as well as configuration/source tests.

## Review the new module

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

Source resolution/configuration are host responsibilities. The annotation frame
receives a validated task and remains the single authoritative editing engine.
The parent retains exported values for inspection, never a competing editable store.

## Files

- `src/preparation/configuration.ts`: supported XML parser and diagnostics.
- `src/preparation/task.ts`: task validation, image resolution, identity, decode.
- `src/preparation/TaskPreparation.tsx`: editable draft configuration/source form.
- `src/probe/model.ts`: general rectangle snapshot/wire conversion.
- `src/probe/ProbeApp.tsx`: assembly, cancellation, disposition, import/export.
- `src/probe/ProbeFrame.tsx`: isolated existing-editor session.

## Validation and limits

On 2026-09-08, all 102 Playground tests and the production build passed. Browser
checks cover the original editing/lifecycle behavior plus configurable names and
labels, XML errors, used-label removal, dirty-work cancel/replace, upload/dimensions,
complete task reload, failed images, and delayed-load supersession.

The inherited Biome configuration is incompatible with the locally installed CLI;
changed files were formatted with an isolated configuration. Root lint and full
repository test/build coverage are not claimed. Production bundle-size warnings remain.

This is still an image-rectangle slice. There is no durable draft persistence,
workflow acceptance, or ComfyUI integration. Exporting is not acceptance. Native
editor bounds adjustment, hit-testing, gesture cancellation, and arbitrary actor
history remain compatibility limits from the first component. Keyboard completeness,
all image formats, remote XML configuration, and full Playground parity are not
certified by this module. See [the original probe guide](COMPONENT_PROBE.md) for
historical first-component validation details.
