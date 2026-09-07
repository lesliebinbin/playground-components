export type Actor = "human" | "ai" | "unknown";
export type Rectangle = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
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
export type Binding = { imageName: string; controlName: string; dataKey: string; labels: string[] };
export const DEFAULT_BINDING: Binding = {
  imageName: "image",
  controlName: "label",
  dataKey: "image",
  labels: ["Person", "Vehicle"],
};
const actors = ["human", "ai", "unknown"];

export function validateSnapshot(value: unknown, binding = DEFAULT_BINDING): Snapshot {
  const s = value as Snapshot;
  if (
    !s ||
    s.schemaVersion !== 1 ||
    !s.source ||
    typeof s.source.id !== "string" ||
    !s.source.id.trim() ||
    !Number.isSafeInteger(s.source.width) ||
    s.source.width <= 0 ||
    !Number.isSafeInteger(s.source.height) ||
    s.source.height <= 0 ||
    !Array.isArray(s.annotations)
  ) {
    throw new Error("Use a version 1 snapshot with a source ID and positive integer image dimensions.");
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
      r.x + r.width > s.source.width + 1e-6 ||
      r.y + r.height > s.source.height + 1e-6
    )
      throw new Error(`Invalid geometry for ${r.id}.`);
    if (!binding.labels.includes(r.label) || !actors.includes(r.origin) || !actors.includes(r.latestEditor)) {
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

export function toWire(input: Snapshot, binding = DEFAULT_BINDING) {
  const snapshot = validateSnapshot(input, binding);
  return snapshot.annotations.map((r) => ({
    id: r.id,
    from_name: binding.controlName,
    to_name: binding.imageName,
    type: "rectanglelabels",
    original_width: snapshot.source.width,
    original_height: snapshot.source.height,
    image_rotation: 0,
    origin: r.origin === "ai" ? (r.latestEditor === "human" ? "prediction-changed" : "prediction") : "manual",
    meta: { probe: { origin: r.origin, latestEditor: r.latestEditor, metadata: r.metadata } },
    value: {
      x: (r.x / snapshot.source.width) * 100,
      y: (r.y / snapshot.source.height) * 100,
      width: (r.width / snapshot.source.width) * 100,
      height: (r.height / snapshot.source.height) * 100,
      rotation: 0,
      rectanglelabels: [r.label],
    },
  }));
}

export function fromWire(results: any[], source = SOURCE, binding = DEFAULT_BINDING): Snapshot {
  if (!Array.isArray(results)) throw new Error("Editor output is not an array.");
  return validateSnapshot(
    {
      schemaVersion: 1,
      source: { ...source },
      annotations: results.map((r) => {
        if (
          r.type !== "rectanglelabels" ||
          r.from_name !== binding.controlName ||
          r.to_name !== binding.imageName ||
          r.image_rotation ||
          r.value?.rotation ||
          r.original_width !== source.width ||
          r.original_height !== source.height ||
          ![r.value?.x, r.value?.y, r.value?.width, r.value?.height].every(Number.isFinite) ||
          r.value?.rectanglelabels?.length !== 1
        ) {
          throw new Error("This component supports one configured label per unrotated rectangle on the loaded image.");
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
          x: (r.value.x / 100) * source.width,
          y: (r.value.y / 100) * source.height,
          width: (r.value.width / 100) * source.width,
          height: (r.value.height / 100) * source.height,
          label: r.value.rectanglelabels[0],
          origin: provenance?.origin ?? inferred,
          latestEditor: r.origin === "prediction-changed" ? "human" : (provenance?.latestEditor ?? inferred),
          metadata: provenance?.metadata ?? {},
        };
      }),
    },
    binding,
  );
}
