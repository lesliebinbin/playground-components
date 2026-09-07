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

## Libraries and API hosts

`libs/editor`, `libs/datamanager`, `libs/core`, and `libs/app-common` are reusable frontend libraries. Consumers that use their data-management, account, storage, or interactive-ML features must configure compatible API endpoints and authentication in their host application. The Playground and standalone editor build without a Label Studio backend.

## Tests

The repository retains its historical unit-test source, which uses Bun's test APIs. The npm standalone workflow does not expose unit-test scripts because those tests cannot run under npm without a test-runner migration. Cypress editor integration tests remain available through `npm run lsf:integration`.
