// Each Jest test file has an isolated module registry; no URL cache suffix is needed.
export const importModulesForTest = (modulePaths) => Promise.all(modulePaths.map((modulePath) => import(modulePath)));
