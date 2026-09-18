import { geoAlbersUsa } from "d3-geo";
import { describe, expect, it } from "vitest";

import {
  BEGIN,
  bakeAtlas,
  dropDegenerateRings,
  END,
  readProjection,
  renderBlob,
  splice,
  type BlockSpec,
} from "./bake-map-geometry.ts";

// A two-square "atlas" in lon/lat: the squares share their vertical border, and a
// third tiny square (below any pixel threshold) checks the tiny-feature fallback.
const atlas = {
  type: "Topology" as const,
  objects: {
    shapes: {
      type: "GeometryCollection" as const,
      geometries: [
        // West and East share arc 0 (the vertical border), traversed in opposite directions.
        // Exterior rings are wound clockwise in lon/lat, as d3-geo's spherical polygons require.
        { type: "Polygon" as const, id: "1", properties: { name: "West" }, arcs: [[0, 1]] },
        { type: "Polygon" as const, id: "2", properties: { name: "East" }, arcs: [[-1, 2]] },
        { type: "Polygon" as const, id: "3", properties: { name: "Speck" }, arcs: [[3]] },
      ],
    },
  },
  arcs: [
    [
      [-95, 40],
      [-95, 30],
    ],
    [
      [-95, 30],
      [-100, 30],
      [-100, 40],
      [-95, 40],
    ],
    [
      [-95, 40],
      [-90, 40],
      [-90, 30],
      [-95, 30],
    ],
    // ~1.2px on a side at this fit: its triangles are under the 2px² threshold, so
    // simplification erases it and only the unsimplified fallback can keep it.
    [
      [-85, 35],
      [-85, 35.012],
      [-84.988, 35.012],
      [-84.988, 35],
      [-85, 35],
    ],
  ],
};

const spec: BlockSpec = {
  atlas: "test://atlas",
  object: "shapes",
  projection: (fc) => geoAlbersUsa().fitSize([1000, 600], fc),
  projectionType: "geoAlbersUsa",
  id: (f) => String(f.id),
  names: true,
  centroids: true,
};

describe("dropDegenerateRings", () => {
  it("removes rings with fewer than three distinct points and keeps the rest", () => {
    expect(dropDegenerateRings("M1,1L1,1L1,1ZM2,2L3,3L4,2Z")).toBe("M2,2L3,3L4,2Z");
    expect(dropDegenerateRings("M1,1L2,2Z")).toBe("");
    expect(dropDegenerateRings("")).toBe("");
  });
});

describe("bakeAtlas", () => {
  it("projects, keeps every feature, and reuses the runtime projection parameters", () => {
    const baked = bakeAtlas(spec, atlas as never);
    expect(baked.features.map((f) => f.id)).toEqual(["1", "2", "3"]);
    expect(baked.features.map((f) => f.name)).toEqual(["West", "East", "Speck"]);
    for (const f of baked.features) {
      expect(f.d).toMatch(/^M[\d.,LMZ-]+Z$/);
      expect(f.c).toHaveLength(2);
      expect(f.d).not.toMatch(/\d\.\d\d/); // one decimal
    }
    // The speck is far below 2px², so it survived only through the unsimplified fallback.
    expect(baked.features[2]!.d.split("L").length).toBeGreaterThanOrEqual(3);
    const projection = spec.projection({ type: "FeatureCollection", features: [] });
    expect(baked.projection.type).toBe("geoAlbersUsa");
    expect(baked.projection.scale).toBeGreaterThan(0);
    expect(readProjection(spec, projection).translate).toHaveLength(2);
  });

  it("keeps the shared border identical on both sides", () => {
    const baked = bakeAtlas(spec, atlas as never);
    const points = (d: string) => new Set(d.replace(/[MZ]/g, "").split("L"));
    const west = points(baked.features[0]!.d);
    const east = points(baked.features[1]!.d);
    const shared = [...west].filter((p) => east.has(p));
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });
});

describe("renderBlob + splice", () => {
  const block = [
    "<script>",
    "  (function () {",
    `    /* ${BEGIN} */`,
    "    var MAP_GEOMETRY = { projection: {}, features: [] };",
    `    /* ${END} */`,
    "    paint(MAP_GEOMETRY);",
    "  })();",
    "</script>",
  ].join("\n");

  it("replaces only the marked region, at the region's indentation", () => {
    const baked = bakeAtlas(spec, atlas as never);
    const out = splice(block, "test", renderBlob("test", spec, baked));
    expect(out.startsWith("<script>\n  (function () {\n    /* BEGIN MAP_GEOMETRY")).toBe(true);
    expect(out.endsWith(`    /* ${END} */\n    paint(MAP_GEOMETRY);\n  })();\n</script>`)).toBe(
      true,
    );
    expect(out).toContain('    var MAP_GEOMETRY = {\n      projection: {"type":"geoAlbersUsa"');
    expect(out).toContain("Regenerate: bun scripts/catalog/bake-map-geometry.ts test");
    // Re-splicing the same blob is idempotent.
    expect(splice(out, "test", renderBlob("test", spec, baked))).toBe(out);
  });

  it("refuses a block without markers", () => {
    expect(() => splice("<script>var x = 1;</script>", "test", "blob")).toThrow(/markers/);
  });
});
