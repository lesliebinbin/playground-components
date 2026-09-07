# Label Studio Web

Label Studio Web is a standalone npm monorepo for reusable Label Studio frontend libraries and static frontend surfaces. It does not contain the Label Studio Python/Django application.

## Install

```sh
npm ci
```

## Frontend surfaces

| Surface | Serve | Build |
| --- | --- | --- |
| Playground | `npm run playground:serve` | `npm run playground:build` |
| Label Studio Frontend editor | `npm run lsf:serve` | `npm run lsf:build` |
| Shared UI Storybook | `npm run storybook:serve` | `npm run storybook:build` |

`npm run build` builds all three surfaces. `npm run lsf:serve-build` serves an already-built editor bundle with Node.

## Deploy beneath a URL prefix

`PUBLIC_BASE_PATH` sets the public URL prefix for all three static builds. When unset,
it defaults to `/`. Use a leading and trailing slash; nested segments are supported.
Segments may contain letters, numbers, underscores, and hyphens. Invalid values
(including an empty value, full URLs, and doubled slashes) fail the build.

```sh
# Domain-root deployment
npm run build

# Deployment at https://example.com/custom_label/
PUBLIC_BASE_PATH=/custom_label/ npm run build
```

Mount the chosen surface's output directory at that URL prefix:

| Surface | Output directory |
| --- | --- |
| Playground | `dist/apps/playground` |
| Editor | `dist/libs/editor` |
| Storybook | `dist/libs/storybook/storybook` |

These are separate sites; choose a separate mount or host for each. Playground's
entry stays at `index.html`, and its assets stay under `playground-assets/`.
The prefixed build references `/custom_label/playground-assets/...` without
requiring root-level asset routes or backend-specific rewrites. Host-provided
API URLs and external sample media keep their existing behavior.

For a local preview, the static server can mount any of these output directories:

```sh
PUBLIC_BASE_PATH=/custom_label/ STATIC_ROOT=dist/apps/playground npm run lsf:serve-build
# Open http://localhost:3000/custom_label/
```

Set `STATIC_ROOT` to the editor or Storybook output directory to preview those
surfaces. Use the same prefix for the build and server; changing the server
environment alone does not change URLs in previously built files.

## Libraries and API hosts

`libs/editor`, `libs/datamanager`, `libs/core`, and `libs/app-common` are reusable frontend libraries. Consumers that use their data-management, account, storage, or interactive-ML features must configure compatible API endpoints and authentication in their host application. The Playground and standalone editor build without a Label Studio backend.

## Tests

Unit tests run on Node with Jest and jsdom. No Bun installation is needed.

```sh
npm test                              # Unit tests and build-configuration tests
npm run test:unit -- libs/editor       # Filter by library or test-file path
npm run test:watch                     # Interactive watch mode
npm run test:config                    # Node tests for PUBLIC_BASE_PATH
npm run test:integration               # Cypress editor integration tests
```

The Jest configuration discovers `.test` and `.spec` files under `libs/` and
`apps/`; Cypress keeps its separate browser runner. See [the unit-test setup](test/jest/README.md)
for the browser shims and shared mock helpers.
