# Label Studio Frontend

The Label Studio Frontend editor is a reusable React annotation interface.

From the repository root:

- `npm run lsf:build` builds a standalone editor bundle.
- `npm run lsf:serve` previews that bundle on <http://localhost:3000>.
- `npm run lsf:serve-build` serves an existing bundle with the Node static server.
- `npm run lsf:integration` runs its Cypress integration suite.

Applications embedding the editor are responsible for providing task data, persistence, authentication, and any API endpoints they use. Historical unit-test source remains but relies on Bun test APIs and has no npm test command.
