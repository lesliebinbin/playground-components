import type { Binding } from "../probe/model";

export const DEFAULT_CONFIG = `<View>
  <Image name="image" value="$image" zoom="true" />
  <RectangleLabels name="label" toName="image" canRotate="false">
    <Label value="Person" background="#16877b" />
    <Label value="Vehicle" background="#b86c45" />
  </RectangleLabels>
</View>`;

const allowed: Record<string, string[]> = {
  View: [],
  Image: ["name", "value", "zoom"],
  RectangleLabels: ["name", "toName", "canRotate", "choice"],
  Label: ["value", "background"],
};
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate the supported rectangle vocabulary; never silently drop unsupported XML. */
export function parseConfiguration(xml: string): Binding {
  if (typeof xml !== "string" || xml.length > 50000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("Configuration must be XML without document types or entity declarations (maximum 50 KB).");
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Malformed XML. Check closing tags and quoted attributes.");
  if (doc.documentElement.tagName !== "View") throw new Error("Configuration must have a View root.");
  for (const node of Array.from(doc.querySelectorAll("*"))) {
    if (!Object.hasOwn(allowed, node.tagName))
      throw new Error(`Unsupported tag: ${node.tagName}. This module supports image rectangles.`);
    for (const attribute of Array.from(node.attributes)) {
      if (!allowed[node.tagName].includes(attribute.name))
        throw new Error(`Unsupported attribute ${attribute.name} on ${node.tagName}.`);
    }
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 && child.textContent?.trim())
        throw new Error("Text content is not supported; use Label value attributes.");
      if (![1, 3, 8].includes(child.nodeType)) throw new Error("Unsupported XML content.");
    }
  }
  const root = doc.documentElement;
  const image = doc.querySelector("Image"),
    control = doc.querySelector("RectangleLabels");
  if (
    root.children.length !== 2 ||
    !image ||
    !control ||
    image.parentNode !== root ||
    control.parentNode !== root ||
    image.children.length
  ) {
    throw new Error("Use one Image and one RectangleLabels directly inside View.");
  }
  const imageName = image.getAttribute("name") || "",
    controlName = control.getAttribute("name") || "";
  const dataKey = image.getAttribute("value")?.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
  if (
    !identifier.test(imageName) ||
    !identifier.test(controlName) ||
    imageName === controlName ||
    !dataKey ||
    [imageName, controlName, dataKey].some((s) => ["__proto__", "constructor", "prototype"].includes(s))
  ) {
    throw new Error("Use distinct valid names and a simple image binding such as $image.");
  }
  if (control.getAttribute("toName") !== imageName)
    throw new Error("RectangleLabels toName must reference the Image name.");
  if (control.getAttribute("canRotate") !== "false")
    throw new Error('Set canRotate="false" for this unrotated rectangle module.');
  if (control.hasAttribute("choice") && control.getAttribute("choice") !== "single")
    throw new Error("Only single-label rectangles are supported.");
  if (image.hasAttribute("zoom") && !["true", "false"].includes(image.getAttribute("zoom")!))
    throw new Error("Image zoom must be true or false.");
  const labels: string[] = [];
  for (const label of Array.from(control.children)) {
    const value = label.getAttribute("value") || "";
    if (
      label.tagName !== "Label" ||
      label.children.length ||
      !value.trim() ||
      value !== value.trim() ||
      labels.includes(value)
    ) {
      throw new Error("Use unique, nonempty Label values inside RectangleLabels.");
    }
    const color = label.getAttribute("background");
    if (color && !/^#[0-9a-f]{6}$/i.test(color))
      throw new Error("Label colors must use six-digit hex values, such as #16877b.");
    labels.push(value);
  }
  if (!labels.length || labels.length > 50) throw new Error("Provide between 1 and 50 labels.");
  return { imageName, controlName, dataKey, labels };
}
