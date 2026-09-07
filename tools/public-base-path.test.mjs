import assert from "node:assert/strict";
import { test } from "node:test";
import { publicBasePath } from "./public-base-path.mjs";

test("defaults to root when the environment variable is absent", () => {
  const previous = process.env.PUBLIC_BASE_PATH;
  delete process.env.PUBLIC_BASE_PATH;
  try {
    assert.equal(publicBasePath(), "/");
  } finally {
    if (previous !== undefined) process.env.PUBLIC_BASE_PATH = previous;
  }
});

test("preserves root and nested deployment paths", () => {
  for (const value of ["/", "/custom_label/", "/team/project-2/"]) {
    assert.equal(publicBasePath(value), value);
    assert.ok(!`${publicBasePath(value)}playground-assets/`.includes("//"));
  }
});

test("rejects malformed paths rather than producing broken asset URLs", () => {
  const invalidPaths = [
    "", "custom_label", "/custom_label", "//host/", "/a//b/", "/../",
    "/a?b/", "/a#b/", "/%2f/", "https://host/", '/"/',
  ];
  for (const value of invalidPaths) {
    assert.throws(() => publicBasePath(value), /PUBLIC_BASE_PATH/);
  }
});
