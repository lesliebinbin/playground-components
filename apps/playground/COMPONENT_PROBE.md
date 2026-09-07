# Annotation component compatibility probe

Historical first-component guide. The repository is now `playground-components`;
the [current guide](COMPONENTS.md) covers configurable labels, source images, and
complete task export/import. Fixed-source restrictions below describe the original
probe, not the expanded module.

A runnable Playground surface for testing an existing editor as an isolated
annotation component. Open **`/?component-probe=1`**. The default `/` still opens
the original Playground.

This repository was copied from the local `label-studio-frontend` checkout at
`22597647c763078d6037c56db9464bcedcadd084`. Application changes are confined to
`apps/playground`; editor, shared libraries, and root build configuration are
unchanged. It retains the frontend's existing npm/Vite/Jest tooling.

## Run

From the repository root, with Node 24 and npm available:

```sh
npm ci
npm run playground:build
PORT=4201 STATIC_ROOT=dist/apps/playground node libs/editor/server.mjs
```

Open [the component probe](http://localhost:4201/?component-probe=1).
The supplied local copy already has installed dependencies and a production build.
For development, use `npm run playground:serve` and open
`http://localhost:4200/?component-probe=1`.

## Try it

1. Load the AI fixture. The inspector shows one rectangle in image coordinates,
   with AI origin. The image is a local SVG test scene; no AI service is required.
2. Move or resize the rectangle directly, or use **Move right 50 px**. Observe
   its identity, geometry, and provenance. Use **Toggle label** for a repeatable
   relabel check on fixture rectangle `r1`.
3. Undo and redo. Select **Vehicle**, then drag a new box around the vehicle.
4. Export a snapshot, inspect the JSON, then load it into a fresh session.
5. Change a width to `-1` and try loading it. The current editor and its history
   should survive validation failure.
6. Click fixture buttons rapidly or click **Dispose** while a fixture is loading.
   Load another fixture afterward; there should be one active editor.

Loading a valid replacement deliberately resets history. Export puts JSON in the
editable text area; it does not save to a backend or accept a workflow result.

## Implementation

- `src/probe/model.ts`: validated fixture snapshot and percentage/image-coordinate
  conversion. One fixed 1000 × 800 source, unrotated rectangles, one known label
  per rectangle, and unique IDs without `#`.
- `src/probe/ProbeFrame.tsx`: real `@humansignal/editor` construction, import,
  snapshot subscription, guarded commands, and export. The selected imported
  annotation is retained instead of creating a new blank annotation.
- `src/probe/ProbeApp.tsx`: frame lifetime and candidate activation, generation
  checks, source/origin-checked browser messages, inspectors, and controls.
- `src/main.tsx`: opt-in route selection; ordinary Playground behavior stays on `/`.

Each session lives in a separate same-origin iframe to isolate the editor's
globals and asynchronous initialization. The old frame stays mounted while a
candidate prepares; only a ready candidate replaces it. Removing a frame destroys
its browsing context, including initialization that has not yet installed the
editor's own destroy callback. These are internal frames, not ComfyUI embedding.
They provide lifecycle isolation, not a security boundary for untrusted code.

The parent holds read-only exported snapshots for inspection. It does not run a
second independently mutable annotation model alongside the editor.

## Validation

```sh
npm run test:unit -- --runInBand apps/playground
npm run playground:build
# With the server above running; requires Google Chrome and Node 24:
node apps/playground/probe-browser-check.mjs
```

Override `CHROME_BIN`, `PROBE_URL`, or `PROBE_SCREENSHOT` when needed. The browser
script launches its own temporary headless Chrome profile, cleans it up, and saves
a screenshot to `/tmp/component-probe.png` by default. Use it for local testing.

Verified on 2026-09-07:

- 80 Playground unit tests passed, including 12 new conversion/validation tests.
- Production Playground build passed, with bundle-size warnings.
- Real-browser checks passed for load, move, provenance, undo/redo, relabel,
  export/reload, invalid-load preservation, dispose during loading, rapid
  replacement, frame-global isolation, pointer drawing, and drawing undo/redo.
- No uncaught browser exceptions in that run.
- Changed files were formatted. The inherited root Biome configuration cannot
  be loaded by the locally installed Biome 2.5.12 (`noUnknownAtRules` configuration
  mismatch); root configuration was left unchanged. Formatting used an isolated
  configuration. Full repository lint is not claimed to pass.

## Compatibility limits

This is a component integration proof, not full Playground equivalence or a
complete implementation of every conceptual contract.

- Native editor gestures adjust shapes to image bounds. They do not implement
  the conceptual invalid-preview/reject policy.
- Native selection ordering, hit tolerances, transform cancellation, resize edge
  cases, and complete keyboard accessibility remain unverified.
- AI ancestry and human changes were tested for the supplied fixtures. Arbitrary
  imported actor history and unknown-origin edits are not certified. Metadata
  carried by this probe uses a reserved `meta.probe` envelope; arbitrary editor
  fields are not guaranteed to survive conversion.
- Internal editor store APIs are pinned dependencies; upgrading requires rerunning
  the probe. The supported snapshot format intentionally rejects other sources,
  modalities, rotations, and ambiguous IDs.
- There is no persistent draft store, accepted-result revision service, ComfyUI
  adapter, project management, or authentication implementation in this probe.

Human validation requested: try the editing and round-trip flow above, then judge
whether this component boundary is a useful foundation for the next module.
