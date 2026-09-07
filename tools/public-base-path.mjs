/** A URL pathname shared by static builds and the local static server. */
export function publicBasePath(value = process.env.PUBLIC_BASE_PATH) {
  if (value === undefined) return "/";
  if (!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/)?$/.test(value)) {
    throw new Error(
      "PUBLIC_BASE_PATH must be / or a path such as /custom_label/ " +
        "(leading and trailing slashes required; segments may contain letters, numbers, underscores, and hyphens).",
    );
  }
  return value;
}
