# Label Studio Frontend

The Label Studio Frontend editor is a reusable React annotation interface.

From the repository root:

- `npm run lsf:build` builds a standalone editor bundle.
- `npm run lsf:serve` previews that bundle on <http://localhost:3000>.
- `npm run lsf:serve-build` serves an existing bundle with the Node static server.
- `npm run lsf:integration` runs its Cypress integration suite.

Build with `PUBLIC_BASE_PATH=/custom_label/ npm run lsf:build` to deploy
`dist/libs/editor` at `/custom_label/`. The default is `/` when the variable is unset.
Preview with `PUBLIC_BASE_PATH=/custom_label/ npm run lsf:serve-build` and open
<http://localhost:3000/custom_label/>. See the repository
[deployment instructions](../../README.md#deploy-beneath-a-url-prefix) for details.

Applications embedding the editor are responsible for providing task data, persistence, authentication, and any API endpoints they use. Run editor unit tests with `npm run test:unit -- libs/editor` from the repository root.
