/**
 * bake-map-geometry — project the map blocks' geography at AUTHORING time.
 *
 * The map blocks used to `fetch()` topojson from a CDN inside the composition and
 * build their GSAP timeline in the `.then()` callback. That breaks two contracts at
 * once: renders depend on the network at capture time, and `window.__timelines[id]`
 * is registered late, so the engine's sub-composition timeline poll waits on it
 * (up to the full 45 s player-ready timeout when the fetch is slow or blocked).
 *
 * This script downloads each atlas ONCE, projects it with the exact projection the
 * block used at runtime, simplifies it to what 1080p can show, and writes the
 * resulting SVG path data between the `BEGIN MAP_GEOMETRY` / `END MAP_GEOMETRY`
 * markers of the block's script. The block then paints synchronously and registers
 * its timeline synchronously. The projection's scale/translate are baked alongside so
 * blocks that still project points at runtime (city bubbles, flow arcs, graticule)
 * reconstruct the SAME projection with `d3.geoX().scale(s).translate(t)`.
 *
 * Usage:
 *   bun scripts/catalog/bake-map-geometry.ts            # all map blocks
 *   bun scripts/catalog/bake-map-geometry.ts us-map     # one block
 *   bun scripts/catalog/bake-map-geometry.ts --check    # exit 1 if any block is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  geoAlbersUsa,
  geoConicConformal,
  geoNaturalEarth1,
  geoPath,
  type GeoProjection,
} from "d3-geo";
import { geoProject } from "d3-geo-projection";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import type { Objects, Topology } from "topojson-specification";

/** An atlas document as topojson-simplify wants it (properties untyped). */
type Atlas = Topology<Objects<{}>>;

const REGISTRY_BLOCKS = resolve(dirname(fileURLToPath(import.meta.url)), "../../registry/blocks");

const BEGIN = "BEGIN MAP_GEOMETRY";
const END = "END MAP_GEOMETRY";

/**
 * Visvalingam threshold in PROJECTED pixels²: a vertex whose removal shifts the outline
 * by less than this area is invisible at the block's 1080p frame. Simplifying after
 * projection (rather than in degrees) keeps every feature, however small, and shared
 * borders stay shared because the projected shapes are re-encoded as one topology first.
 */
const MIN_TRIANGLE_AREA_PX2 = 2;

interface BakedProjection {
  type: "geoAlbersUsa" | "geoNaturalEarth1" | "geoConicConformal";
  scale: number;
  translate: [number, number];
  center?: [number, number];
  rotate?: [number, number];
}

interface BakedFeature {
  id: string;
  name?: string;
  d: string;
  c?: [number, number];
}

interface BlockSpec {
  /** Pinned atlas URL — the same file the block used to fetch at render time. */
  atlas: string;
  object: string;
  /** Builds the runtime projection from the feature collection (fitSize needs it). */
  projection: (fc: FeatureCollection) => GeoProjection;
  projectionType: BakedProjection["type"];
  /** Normalise the topojson feature id to the key the block's data table uses. */
  id: (f: Feature) => string;
  /** Bake `properties.name` (blocks that match features by name). */
  names?: boolean;
  /** Bake the path centroid (blocks that place labels). */
  centroids?: boolean;
  minTriangleAreaPx2?: number;
}

const US_STATES = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json";
const fips = (f: Feature) => String(f.id).padStart(2, "0");

const BLOCKS: Record<string, BlockSpec> = {
  "us-map": {
    atlas: US_STATES,
    object: "states",
    projection: (fc) => geoAlbersUsa().fitSize([1380, 800], fc),
    projectionType: "geoAlbersUsa",
    id: fips,
    centroids: true,
  },
  "us-map-bubble": {
    atlas: US_STATES,
    object: "states",
    projection: (fc) => geoAlbersUsa().fitSize([1380, 800], fc),
    projectionType: "geoAlbersUsa",
    id: fips,
  },
  "us-map-flow": {
    atlas: US_STATES,
    object: "states",
    projection: () => geoAlbersUsa().scale(1300).translate([960, 560]),
    projectionType: "geoAlbersUsa",
    id: fips,
  },
  "world-map": {
    atlas: "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json",
    object: "countries",
    projection: () => geoNaturalEarth1().fitSize([1380, 700], { type: "Sphere" }),
    projectionType: "geoNaturalEarth1",
    id: (f) => String(f.id).padStart(3, "0"),
    names: true,
  },
  "spain-map": {
    atlas: "https://cdn.jsdelivr.net/npm/es-atlas@0.6.0/es/autonomous_regions.json",
    object: "autonomous_regions",
    projection: (fc) =>
      geoConicConformal().center([0, 39.5]).rotate([3.5, 0]).fitSize([1200, 750], fc),
    projectionType: "geoConicConformal",
    id: fips,
    names: true,
    centroids: true,
  },
};

const atlasCache = new Map<string, Promise<Atlas>>();
function loadAtlas(url: string): Promise<Atlas> {
  let pending = atlasCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      // The atlas files are topojson documents; the shape is checked by topojson-client.
      return (await res.json()) as Atlas;
    });
    atlasCache.set(url, pending);
  }
  return pending;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Simplification collapses the smallest islands to a ring of one or two distinct
 * points. Those rings paint nothing, so drop them instead of shipping "M x,y L x,y Z".
 */
function dropDegenerateRings(d: string): string {
  return d
    .split("M")
    .filter((ring) => ring.length > 0)
    .filter((ring) => new Set(ring.replace(/Z$/, "").split("L")).size >= 3)
    .map((ring) => `M${ring}`)
    .join("");
}

function readProjection(spec: BlockSpec, projection: GeoProjection): BakedProjection {
  const [tx, ty] = projection.translate();
  const baked: BakedProjection = {
    type: spec.projectionType,
    scale: round1(projection.scale()),
    translate: [round1(tx), round1(ty)],
  };
  if (spec.projectionType === "geoConicConformal") {
    const [cx, cy] = projection.center();
    const [rx, ry] = projection.rotate();
    baked.center = [cx, cy];
    baked.rotate = [rx, ry];
  }
  return baked;
}

async function bake(
  spec: BlockSpec,
): Promise<{ projection: BakedProjection; features: BakedFeature[] }> {
  const atlas = await loadAtlas(spec.atlas);
  const object = atlas.objects[spec.object];
  if (!object) throw new Error(`${spec.atlas}: no object "${spec.object}"`);
  // topojson-client types feature() by the object's geometry kind; every atlas object here
  // is a GeometryCollection, so the result is a FeatureCollection.
  const full = feature(atlas, object) as unknown as FeatureCollection;
  const projection = spec.projection(full);
  // 1. Project to the block's pixel space with d3's stream pipeline (antimeridian cuts and
  //    the projection's own clipping included), exactly as geoPath(projection) would.
  const planar = geoProject(full, projection) as FeatureCollection;
  // 2. Re-encode as a topology so adjacent features share arcs, then simplify those arcs
  //    once — neighbours can't drift apart or open slivers along a common border.
  // topojson-server keeps GeoJSON's loosely typed properties; topojson-simplify wants them erased.
  const shared = topology({ shapes: planar }) as unknown as Atlas;
  const simplified = simplify(
    presimplify(shared),
    spec.minTriangleAreaPx2 ?? MIN_TRIANGLE_AREA_PX2,
  );
  const shapes = feature(simplified, simplified.objects.shapes!) as unknown as FeatureCollection;
  // 3. Emit planar path data (no projection: the coordinates already are pixels).
  const path = geoPath().digits(1);
  const features: BakedFeature[] = [];
  shapes.features.forEach((f, i) => {
    let d = dropDegenerateRings(path(f as Feature<Geometry>) ?? "");
    if (!d) {
      // A feature smaller than the threshold (Ceuta, a Caribbean island state) collapses
      // to nothing; it must still paint, so it keeps its unsimplified outline instead.
      d = dropDegenerateRings(path(planar.features[i] as Feature<Geometry>) ?? "");
    }
    if (!d) return;
    const baked: BakedFeature = { id: spec.id(f), d };
    if (spec.names) {
      const name = f.properties?.name;
      if (typeof name === "string") baked.name = name;
    }
    if (spec.centroids) {
      const [cx, cy] = path.centroid(f as Feature<Geometry>);
      if (Number.isFinite(cx) && Number.isFinite(cy)) baked.c = [round1(cx), round1(cy)];
    }
    features.push(baked);
  });
  features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { projection: readProjection(spec, projection), features };
}

function renderBlob(
  name: string,
  spec: BlockSpec,
  baked: { projection: BakedProjection; features: BakedFeature[] },
  indent: string,
): string {
  const minArea = spec.minTriangleAreaPx2 ?? MIN_TRIANGLE_AREA_PX2;
  const lines = [
    `${indent}/* ${BEGIN} — generated by scripts/catalog/bake-map-geometry.ts, do not edit by hand.`,
    `${indent}   Source: ${spec.atlas} (object "${spec.object}"),`,
    `${indent}   projected with d3.${spec.projectionType} exactly as this block did at runtime,`,
    `${indent}   simplified in pixel space (Visvalingam, min triangle area ${minArea}px²), coordinates rounded to 0.1px.`,
    `${indent}   Regenerate: bun scripts/catalog/bake-map-geometry.ts ${name} */`,
    `${indent}var MAP_GEOMETRY = {`,
    `${indent}  projection: ${JSON.stringify(baked.projection)},`,
    `${indent}  features: [`,
    ...baked.features.map((f) => `${indent}    ${JSON.stringify(f)},`),
    `${indent}  ],`,
    `${indent}};`,
    `${indent}/* ${END} */`,
  ];
  return lines.join("\n");
}

function splice(html: string, name: string, blob: string): string {
  const begin = html.indexOf(`/* ${BEGIN}`);
  const endMarker = `/* ${END} */`;
  const end = html.indexOf(endMarker);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`${name}: missing ${BEGIN} / ${END} markers in the block script`);
  }
  const lineStart = html.lastIndexOf("\n", begin) + 1;
  return html.slice(0, lineStart) + blob + html.slice(end + endMarker.length);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const names = args.filter((a) => !a.startsWith("--"));
  const targets = names.length ? names : Object.keys(BLOCKS);
  let stale = 0;
  for (const name of targets) {
    const spec = BLOCKS[name];
    if (!spec)
      throw new Error(`unknown map block "${name}" (known: ${Object.keys(BLOCKS).join(", ")})`);
    const file = resolve(REGISTRY_BLOCKS, name, `${name}.html`);
    const html = readFileSync(file, "utf8");
    const begin = html.indexOf(`/* ${BEGIN}`);
    const indent = begin < 0 ? "" : html.slice(html.lastIndexOf("\n", begin) + 1, begin);
    const baked = await bake(spec);
    const next = splice(html, name, renderBlob(name, spec, baked, indent));
    const bytes =
      Buffer.byteLength(next) -
      Buffer.byteLength(html.replace(/\/\* BEGIN MAP_GEOMETRY[\s\S]*?END MAP_GEOMETRY \*\//, ""));
    if (next === html) {
      console.log(`  = ${name}: up to date (${baked.features.length} features, ${bytes} bytes)`);
      continue;
    }
    if (check) {
      console.error(
        `  ! ${name}: baked geometry is stale — run bun scripts/catalog/bake-map-geometry.ts ${name}`,
      );
      stale++;
      continue;
    }
    writeFileSync(file, next);
    console.log(`  ~ ${name}: baked ${baked.features.length} features (${bytes} bytes)`);
  }
  if (stale) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
