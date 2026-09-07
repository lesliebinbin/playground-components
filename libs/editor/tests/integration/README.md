# LSF Cypress integration tests

Cypress e2e tests for the Label Studio Frontend editor. They run in CI against the same production standalone build that this doc describes.

## Local verification (CI-like build + Cypress UI)

To reproduce CI locally and debug in Cypress UI:

**1. Build the editor (production standalone, same as CI)**

From the repository root:

```bash
npm run lsf:build
```

**2. Serve the build on port 3000**

In the same or another terminal:

```bash
npm run lsf:serve-build
```

(Uses the Node static server in `libs/editor/server.mjs`. Port `3000` by default; override with `PORT`.)

Leave this running. Confirm in the browser: [http://localhost:3000](http://localhost:3000) should load the LSF app (and CSS).

**3. Run Cypress in UI mode**

In a second terminal, from `web/`:

```bash
npm run lsf:integration:watch
```

This opens the Cypress UI. Choose a spec and run it; tests will hit `http://localhost:3000` (baseUrl in config). You can step through, inspect the app, and see exactly what Cypress sees.

To run headless (like CI) instead:

```bash
npm run lsf:integration
```
