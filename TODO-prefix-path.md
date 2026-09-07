# Prefix-path deployment TODO

## Context

This repository began as the `web/` directory from
[HumanSignal/label-studio](https://github.com/HumanSignal/label-studio).
It was extracted to `/home/lesliebinbinhuang/codings/label-studio-web` so
that its reusable frontend surfaces can be developed and deployed separately
from the Python/Django application.

## Completed migration

- Converted the repository from Bun to npm. Use `npm ci` to install
  dependencies and `npm run <script>` for project commands.
- Replaced `bun.lock` with `package-lock.json` and removed Bun-specific
  runnable workflows.
- Removed the Django-hosted `apps/labelstudio` application, its Cypress e2e
  app, Django manifest generation, and service-worker copy tooling. They
  depended on the parent Label Studio backend checkout and cannot be deployed
  meaningfully as a standalone static application.
- Kept the independently useful frontend surfaces:
  - Playground: `npm run playground:serve` and `npm run playground:build`
  - Standalone Label Studio Frontend editor: `npm run lsf:serve` and
    `npm run lsf:build`
  - Shared UI Storybook: `npm run storybook:serve` and
    `npm run storybook:build`
- Added `apps/playground/src/config/feature-flags.json`, a committed snapshot
  copied from the upstream backend's `label_studio/feature_flags.json`.
  `apps/playground/src/utils/embedFeatureFlags.ts` imports that local file,
  so Playground no longer requires the backend checkout at build time.
- `npm run build` builds the retained static surfaces.

The reusable libraries can still call APIs when embedded in a host
application. That is an intentional runtime integration, not a dependency on
the old repository layout.

## Remaining work: support a deployment prefix

The static outputs currently assume they are hosted at the domain root. A
deployment such as `https://example.com/custom_label/` is not supported
without a reverse proxy that exposes root-level asset paths.

Current blockers:

- `vite.config.playground.ts` sets the production Vite base to
  `/playground-assets/`. A page at `/custom_label/` therefore requests
  `/playground-assets/...`, rather than
  `/custom_label/playground-assets/...`.
- `vite.config.editor.ts` sets `base: "/"`, so standalone editor assets also
  resolve from the domain root.
- Verify Storybook's generated asset URLs too; it is included in
  `npm run build` and should follow the same deployment-prefix contract.

## Goal

Allow every retained static surface to be served below a configurable prefix,
including:

```text
https://example.com/custom_label/
https://example.com/custom_label/playground-assets/
```

The solution must preserve root deployment as the default and must not require
a backend-specific reverse-proxy rewrite.

## Suggested approach

1. Introduce one documented build-time environment variable for the public
   base path, for example `PUBLIC_BASE_PATH=/custom_label/`.
2. Normalize and validate it in shared Vite configuration logic:
   - default to `/`;
   - require leading and trailing slashes;
   - avoid doubled slashes when composing the Playground asset path.
3. Use the normalized value for Vite `base` in Playground, standalone editor,
   and Storybook.
4. Preserve the Playground output layout: its entry document remains at
   `dist/apps/playground/index.html`, while static files remain under
   `dist/apps/playground/playground-assets/`. With the example prefix, emitted
   HTML should point to `/custom_label/playground-assets/...`.
5. Review hard-coded root-relative URLs in retained application code and
   public assets. Convert only URLs that represent this static deployment;
   do not rewrite intentional API endpoints supplied by a host application.
6. Update `README.md` and relevant surface documentation with root and
   prefix-path build/deployment examples.

## Acceptance criteria

Run the normal root build and a prefixed build:

```sh
npm ci
npm run build
PUBLIC_BASE_PATH=/custom_label/ npm run build
```

For the prefixed build, inspect the generated HTML and asset references to
confirm that:

- Playground entry HTML references
  `/custom_label/playground-assets/...`;
- standalone editor and Storybook assets use the configured prefix;
- CSS, JavaScript, fonts, images, and dynamically imported chunks resolve
  under the prefix;
- root deployment remains unchanged when `PUBLIC_BASE_PATH` is unset.

Start the relevant static server or a minimal prefix-aware local server and
verify that a browser can load each surface beneath `/custom_label/` without
404s for its initial or lazy-loaded assets.
