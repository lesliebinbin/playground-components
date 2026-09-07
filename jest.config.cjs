const path = require("node:path");
const paths = require("./tsconfig.base.json").compilerOptions.paths;
const aliases = Object.fromEntries(
  Object.entries(paths).map(([key, [target]]) => [
    "^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\*", "(.*)") + "$",
    "<rootDir>/" + target.replace("*", "$1"),
  ]),
);
module.exports = {
  testEnvironment: "<rootDir>/test/jest/environment.cjs",
  testMatch: ["<rootDir>/libs/**/?(*.)+(spec|test).[jt]s?(x)", "<rootDir>/apps/**/?(*.)+(spec|test).[jt]s?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/cypress/", "/tests/integration/"],
  modulePathIgnorePatterns: ["<rootDir>/(?:libs|apps)/.*/__mocks__/", "<rootDir>/__mocks__/"],
  setupFilesAfterEnv: ["<rootDir>/test/jest/setup.ts"],
  moduleNameMapper: {
    "^json-edit-react$": "<rootDir>/node_modules/json-edit-react/build/index.esm.js",
    "^konva$": "<rootDir>/test/jest/konva.cjs",
    "\\.(wasm)(?:\\?url)?$": "<rootDir>/test/jest/file.cjs",
    "^jotai$": "<rootDir>/node_modules/jotai/esm/index.mjs",
    "^react-konva-utils$": "<rootDir>/node_modules/react-konva-utils/es/index.js",
    "^@humansignal/ui/src/(.*)$": "<rootDir>/libs/ui/src/$1",
    ...aliases,
    "^apps/(.*)$": "<rootDir>/apps/$1",
    "^@/(.*)$": "<rootDir>/apps/playground/src/$1",
    "\\.(css|scss|sass|less)$": "identity-obj-proxy",
    "\\.svg$": "<rootDir>/test/jest/svg.cjs",
    "\\.(png|jpe?g|gif|webp|ico|woff2?|ttf|mp3|mp4|wav|xml)$": "<rootDir>/test/jest/file.cjs",
    "^jest-fetch-mock$": "<rootDir>/libs/editor/__mocks__/jest-fetch-mock.js",
  },
  transform: { "^.+\\.[cm]?[jt]sx?$": "<rootDir>/test/jest/transform.cjs" },
  transformIgnorePatterns: [],
  maxWorkers: 2,
  testTimeout: 10000,
};
