import { fixture, fromWire, toWire, validateSnapshot } from "./model";

describe("probe result boundary", () => {
  test.each(["human", "ai"] as const)("round-trips %s identity, pixels, provenance and metadata", (actor) => {
    const input = fixture(actor);
    input.annotations[0].x = 100.25;
    input.annotations[0].metadata = { nested: { tags: ["retained", 42] } };
    expect(fromWire(toWire(input))).toEqual(input);
  });
  test("uses height for y and height percentages", () => {
    expect(toWire(fixture("ai"))[0].value).toMatchObject({ x: 10, y: 15, width: 20, height: 20 });
  });
  test("retains AI origin when the engine reports a human edit", () => {
    const wire = toWire(fixture("ai"));
    wire[0].origin = "prediction-changed";
    expect(fromWire(wire).annotations[0]).toMatchObject({ origin: "ai", latestEditor: "human" });
  });
  test("preserves explicit unknown provenance rather than inferring human", () => {
    const input = fixture("human");
    input.annotations[0].origin = "unknown";
    input.annotations[0].latestEditor = "unknown";
    expect(fromWire(toWire(input))).toEqual(input);
  });
  test.each([NaN, Infinity, -1, 900])("rejects invalid x %s without mutating input", (x) => {
    const input = fixture("ai");
    input.annotations[0].x = x;
    expect(() => validateSnapshot(input)).toThrow("Invalid geometry");
    expect(input.annotations[0].x).toBe(x);
  });
  test("rejects a partly valid batch and ambiguous IDs", () => {
    const input = fixture("ai");
    input.annotations.push({ ...input.annotations[0] });
    expect(() => toWire(input)).toThrow("unique");
    input.annotations[1].id = "r2#ambiguous";
    expect(() => toWire(input)).toThrow("#");
    expect(input.annotations).toHaveLength(2);
  });
  test("rejects unsupported rotations and shapes instead of dropping them", () => {
    const wire = toWire(fixture("ai"));
    wire[0].value.rotation = 15;
    expect(() => fromWire(wire)).toThrow("unrotated");
    expect(() => fromWire([{ ...wire[0], type: "polygonlabels" }])).toThrow();
  });
  test("returns detached snapshots", () => {
    const input = fixture("ai");
    const result = validateSnapshot(input);
    result.annotations[0].metadata.fixture = "changed";
    expect(input.annotations[0].metadata.fixture).toBe("ai-rectangle");
  });
});
