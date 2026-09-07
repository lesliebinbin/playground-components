import { DEFAULT_CONFIG, parseConfiguration } from "./configuration";
import { fixture, fromWire, toWire } from "../probe/model";
import { validateTask } from "./task";

describe("configuration boundary", () => {
  test("extracts configurable names, source binding and labels", () => {
    const config = DEFAULT_CONFIG.replaceAll('name="image"', 'name="photo"')
      .replace('toName="image"', 'toName="photo"')
      .replace('name="label"', 'name="boxes"')
      .replace("$image", "$asset")
      .replace("Person", "Tree");
    expect(parseConfiguration(config)).toEqual({
      imageName: "photo",
      controlName: "boxes",
      dataKey: "asset",
      labels: ["Tree", "Vehicle"],
    });
  });
  test.each([
    ["malformed XML", DEFAULT_CONFIG.replace("</View>", "")],
    ["unsupported modality", DEFAULT_CONFIG.replaceAll("Image", "Audio")],
    ["broken reference", DEFAULT_CONFIG.replace('toName="image"', 'toName="missing"')],
    ["duplicate labels", DEFAULT_CONFIG.replace("Vehicle", "Person")],
    ["blank labels", DEFAULT_CONFIG.replace("Person", " ")],
    ["unknown attribute", DEFAULT_CONFIG.replace("<View>", '<View visibleWhen="foo">')],
    ["rotation", DEFAULT_CONFIG.replace('canRotate="false"', 'canRotate="true"')],
    ["multiple labels", DEFAULT_CONFIG.replace("<RectangleLabels ", '<RectangleLabels choice="multiple" ')],
    ["missing binding", DEFAULT_CONFIG.replace("$image", "image")],
    ["unsafe binding", DEFAULT_CONFIG.replace("$image", "$__proto__")],
    [
      "nested label markup",
      DEFAULT_CONFIG.replace('value="Person" background="#16877b" />', 'value="Person"><Image /></Label>'),
    ],
    ["entity declaration", '<!DOCTYPE View [<!ENTITY a "hello">]>' + DEFAULT_CONFIG],
  ])("rejects %s instead of partially accepting it", (_name, xml) => expect(() => parseConfiguration(xml)).toThrow());
  test("preserves comments and XML-escaped label names", () => {
    expect(
      parseConfiguration(DEFAULT_CONFIG.replace("<View>", "<View><!-- draft -->").replace("Person", "Rock &amp; Tree"))
        .labels[0],
    ).toBe("Rock & Tree");
  });
  test("round-trips non-default image geometry and labels through the real boundary", () => {
    const config = DEFAULT_CONFIG.replace("Person", "Tree");
    const binding = parseConfiguration(config);
    const snapshot = fixture("human");
    snapshot.source = { id: "new", width: 640, height: 480 };
    snapshot.annotations[0] = { ...snapshot.annotations[0], x: 64, y: 48, width: 128, height: 96, label: "Tree" };
    const wire = toWire(snapshot, binding);
    expect(wire[0].value).toMatchObject({ x: 10, y: 10, width: 20, height: 20, rectanglelabels: ["Tree"] });
    expect(fromWire(wire, snapshot.source, binding)).toEqual(snapshot);
  });
});

describe("task document validation", () => {
  const task = () => ({
    format: "playground-task-v1",
    config: DEFAULT_CONFIG,
    imageUrl: "https://example.com/image.png",
    snapshot: fixture("ai"),
  });
  test("validates and detaches an imported task", () => {
    const original = task(),
      result = validateTask(original);
    result.snapshot.annotations[0].x = 50;
    expect(original.snapshot.annotations[0].x).toBe(100);
  });
  test("rejects configuration that removes a used label without changing the input", () => {
    const original = task();
    original.config = original.config.replace("Person", "Tree");
    expect(() => validateTask(original)).toThrow("Unsupported label");
    expect(original.snapshot.annotations[0].label).toBe("Person");
  });
  test.each(["", "javascript:alert(1)", "file:///etc/passwd", "data:text/html;base64,PGgxPg=="])(
    "rejects invalid source %s",
    (imageUrl) => {
      expect(() => validateTask({ ...task(), imageUrl })).toThrow();
    },
  );
  test("rejects unsupported document versions", () =>
    expect(() => validateTask({ ...task(), format: "next" })).toThrow());
});
