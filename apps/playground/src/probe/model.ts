export type Actor = "human" | "ai" | "unknown";
export type Rectangle = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: "Person" | "Vehicle";
  origin: Actor;
  latestEditor: Actor;
  metadata: Record<string, unknown>;
};
export type Snapshot = {
  schemaVersion: 1;
  source: { id: string; width: number; height: number };
  annotations: Rectangle[];
};
export const SOURCE = { id: "courtyard", width: 1000, height: 800 };
export const CHANNEL = "playground-component-probe-v1";
const actors = ["human", "ai", "unknown"];
const labels = ["Person", "Vehicle"];

export function validateSnapshot(value: unknown): Snapshot {
  const s = value as Snapshot;
  if (
    !s ||
    s.schemaVersion !== 1 ||
    !s.source ||
    s.source.id !== SOURCE.id ||
    s.source.width !== SOURCE.width ||
    s.source.height !== SOURCE.height ||
    !Array.isArray(s.annotations)
  ) {
    throw new Error("Use a version 1 snapshot for the 1000 × 800 courtyard image.");
  }
  const ids = new Set<string>();
  for (const r of s.annotations) {
    if (!r || typeof r.id !== "string" || !r.id || r.id.includes("#") || ids.has(r.id)) {
      throw new Error("Rectangle IDs must be unique, nonempty, and contain no # character.");
    }
    ids.add(r.id);
    if (
      ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width <= 0 ||
      r.height <= 0 ||
      r.x + r.width > SOURCE.width + 1e-6 ||
      r.y + r.height > SOURCE.height + 1e-6
    )
      throw new Error(`Invalid geometry for ${r.id}.`);
    if (!labels.includes(r.label) || !actors.includes(r.origin) || !actors.includes(r.latestEditor)) {
      throw new Error(`Unsupported label or provenance for ${r.id}.`);
    }
    if (!r.metadata || typeof r.metadata !== "object" || Array.isArray(r.metadata)) {
      throw new Error(`Metadata for ${r.id} must be an object.`);
    }
  }
  return JSON.parse(JSON.stringify(s));
}

export function fixture(actor: "human" | "ai"): Snapshot {
  return {
    schemaVersion: 1,
    source: { ...SOURCE },
    annotations: [
      {
        id: "r1",
        x: 100,
        y: 120,
        width: 200,
        height: 160,
        label: "Person",
        origin: actor,
        latestEditor: actor,
        metadata: { fixture: `${actor}-rectangle` },
      },
    ],
  };
}

export function toWire(input: Snapshot) {
  const snapshot = validateSnapshot(input);
  return snapshot.annotations.map((r) => ({
    id: r.id,
    from_name: "label",
    to_name: "image",
    type: "rectanglelabels",
    original_width: SOURCE.width,
    original_height: SOURCE.height,
    image_rotation: 0,
    origin: r.origin === "ai" ? (r.latestEditor === "human" ? "prediction-changed" : "prediction") : "manual",
    meta: { probe: { origin: r.origin, latestEditor: r.latestEditor, metadata: r.metadata } },
    value: {
      x: r.x / 10,
      y: r.y / 8,
      width: r.width / 10,
      height: r.height / 8,
      rotation: 0,
      rectanglelabels: [r.label],
    },
  }));
}

export function fromWire(results: any[]): Snapshot {
  if (!Array.isArray(results)) throw new Error("Editor output is not an array.");
  return validateSnapshot({
    schemaVersion: 1,
    source: { ...SOURCE },
    annotations: results.map((r) => {
      if (
        r.type !== "rectanglelabels" ||
        r.from_name !== "label" ||
        r.to_name !== "image" ||
        r.image_rotation ||
        r.value?.rotation ||
        r.original_width !== SOURCE.width ||
        r.original_height !== SOURCE.height ||
        r.value?.rectanglelabels?.length !== 1
      ) {
        throw new Error("This probe supports one label per unrotated rectangle on the courtyard image.");
      }
      const provenance = r.meta?.probe;
      const inferred: Actor =
        r.origin === "prediction" || r.origin === "prediction-changed"
          ? "ai"
          : r.origin === "manual"
            ? "human"
            : "unknown";
      return {
        id: r.id,
        x: r.value.x * 10,
        y: r.value.y * 8,
        width: r.value.width * 10,
        height: r.value.height * 8,
        label: r.value.rectanglelabels[0],
        origin: provenance?.origin ?? inferred,
        latestEditor: r.origin === "prediction-changed" ? "human" : (provenance?.latestEditor ?? inferred),
        metadata: provenance?.metadata ?? {},
      };
    }),
  });
}
