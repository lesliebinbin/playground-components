module.exports = require("babel-jest").createTransformer({
  babelrc: false,
  configFile: false,
  excludeJestPreset: true,
  assumptions: { constantReexports: true },
  presets: [
    ["@babel/preset-env", { targets: { node: "current" }, modules: false }],
    ["@babel/preset-react", { runtime: "automatic" }],
    ["@babel/preset-typescript", { allExtensions: true, isTSX: true, allowDeclareFields: true }],
  ],
  plugins: [
    "@babel/plugin-transform-dynamic-import",
    "@babel/plugin-transform-export-namespace-from",
    ["@babel/plugin-transform-modules-commonjs", { lazy: () => true, allowTopLevelThis: true }],
  ],
});
