# Unit tests

Run `npm test` from the repository root to run Jest unit tests and the Node
build-configuration tests. `npm run test:unit -- <path>` filters Jest tests;
`npm run test:watch` starts watch mode. Cypress runs separately with
`npm run test:integration`.

Jest discovers `.test` and `.spec` files under `apps/` and `libs/`, including JSX
in `.js` files. Each file gets an isolated module registry and jsdom environment.
No application build or backend is required.

## Configuration

- `jest.config.cjs` shares the TypeScript path aliases and maps styles, assets,
  and Konva to test doubles. Legacy manual-mock directories are excluded from
  automatic discovery; tests may still import their helpers explicitly.
- `transform.cjs` compiles TypeScript, JSX, and ESM dependencies with Babel.
  Imports are evaluated on first use so existing factories can be registered
  with `jest.doMock` before the subject loads. Modules required for side effects
  (such as tag registration) must use a side-effect import or explicit `require`.
  Lifecycle-hook libraries are loaded in setup, before tests begin.
- `environment.cjs` uses the repository's jsdom version, adds Node's Fetch and
  encoding APIs, and handles the unsupported `:modal`/`:popover-open` selectors.
  jsdom has no native top-layer state; delegating these selectors to nwsapi
  otherwise recurses through `Element.matches` during accessibility queries.
- `setup.ts` provides the existing canvas/media, feature-flag, fetch, and MST
  doubles, along with DOM and mock cleanup. Test failures still propagate to Jest.

## Existing test helpers

Prefer standard `jest.fn`, `jest.spyOn`, `jest.doMock`, and `jest.requireActual`
for new tests. The existing suite also uses these globals:

- `mock()` creates a Jest mock; `spyOn()` additionally supports replacing React
  `memo`/`forwardRef` component exports.
- `mockModule(jest, id, factory)` merges a partial mock with actual exports.
  Pass the calling file's `jest` object to resolve relative paths correctly.
  A factory returning `__skipMerge: true` supplies the entire module instead.
- `mockFF()` provides `setup`, `set`, and `reset` for feature flags.
- Timer and mock-lifecycle aliases call the corresponding Jest methods.
  Enable fake timers before calling `setSystemTime`.

Register module mocks before importing the subject. Reapply spies in `beforeEach`
when later tests need them: setup restores spies after every test. Use `cleanup()`
before destroying an MST store that still has mounted observer components.
