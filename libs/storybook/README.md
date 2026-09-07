# Shared UI Storybook

From the repository root, run `npm run storybook:serve` for development or
`npm run storybook:build` to build a site for deployment at `/`.

For a prefixed deployment:

```sh
PUBLIC_BASE_PATH=/custom_label/ npm run storybook:build
PUBLIC_BASE_PATH=/custom_label/ STATIC_ROOT=dist/libs/storybook/storybook npm run lsf:serve-build
```

Open <http://localhost:3000/custom_label/>. Mount `dist/libs/storybook/storybook`
at the same prefix in production. Both the manager and story preview use it.
See the repository [deployment instructions](../../README.md#deploy-beneath-a-url-prefix)
for the shared environment variable contract.
