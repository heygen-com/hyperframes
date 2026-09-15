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
 * The spliced block is run through oxfmt before it is written or compared, so the
 * repo's `format:check` and this script's `--check` agree on the same bytes.
 *
 * Usage:
 *   bun scripts/catalog/bake-map-geometry.ts            # all map blocks
 *   bun scripts/catalog/bake-map-geometry.ts us-map     # one block
 *   bun scripts/catalog/bake-map-geometry.ts --check    # exit 1 if any block is stale
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  geoAlbersUsa,
  geoConicConformal,
  geoNaturalEarth1,
  geoPath,
  type GeoPath,
  type GeoProjection,
} from "d3-geo";
import { geoProject } from "d3-geo-projection";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import type { Objects, Topology } from "topojson-specification";

import { isEntrypoint } from "../entrypoint.ts";

/** An atlas document as topojson-simplify wants it (properties untyped). */
type Atlas = Topology<Objects<{}>>;

const REGISTRY_BLOCKS = resolve(dirname(fileURLToPath(import.meta.url)), "../../registry/blocks");

export const BEGIN = "BEGIN MAP_GEOMETRY";
export const END = "END MAP_GEOMETRY";

/**
 * Visvalingam threshold in PROJECTED pixels²: a vertex whose removal shifts the outline
 * by less than this area is invisible at the block's 1080p frame. Simplifying after
 * projection (rather than in degrees) keeps every feature, however small, and shared
 * borders stay shared because the projected shapes are re-encoded as one topology first.
 */
export const MIN_TRIANGLE_AREA_PX2 = 2;

export interface BakedProjection {
  type: "geoAlbersUsa" | "geoNaturalEarth1" | "geoConicConformal";
  scale: number;
  translate: [number, number];
  center?: [number, number];
  rotate?: [number, number];
}

export interface BakedFeature {
  id: string;
  name?: string;
  d: string;
  c?: [number, number];
}

export interface BakedGeometry {
  projection: BakedProjection;
  features: BakedFeature[];
}

export interface BlockSpec {
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

export const BLOCKS: Record<string, BlockSpec> = {
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
export function dropDegenerateRings(d: string): string {
  return d
    .split("M")
    .filter((ring) => ring.length > 0)
    .filter((ring) => new Set(ring.replace(/Z$/, "").split("L")).size >= 3)
    .map((ring) => `M${ring}`)
    .join("");
}

export function readProjection(spec: BlockSpec, projection: GeoProjection): BakedProjection {
  const [tx, ty] = projection.translate();
  const baked: BakedProjection = {
    type: spec.projectionType,
    scale: projection.scale(),
    translate: [tx, ty],
  };
  if (spec.projectionType === "geoConicConformal") {
    const [cx, cy] = projection.center();
    const [rx, ry] = projection.rotate();
    baked.center = [cx, cy];
    baked.rotate = [rx, ry];
  }
  return baked;
}

/**
 * A feature's path data, falling back to its unsimplified outline: a feature smaller than
 * the threshold (Ceuta, a Caribbean island state) collapses to nothing under
 * simplification, and it must still paint.
 */
export function featurePath(path: GeoPath, simplified: Feature, fallback: Feature): string {
  const d = dropDegenerateRings(path(simplified as Feature<Geometry>) ?? "");
  return d || dropDegenerateRings(path(fallback as Feature<Geometry>) ?? "");
}

function featureName(spec: BlockSpec, f: Feature): { name?: string } {
  const name = f.properties?.name;
  return spec.names && typeof name === "string" ? { name } : {};
}

function featureCentroid(spec: BlockSpec, path: GeoPath, f: Feature): { c?: [number, number] } {
  if (!spec.centroids) return {};
  const [cx, cy] = path.centroid(f as Feature<Geometry>);
  return Number.isFinite(cx) && Number.isFinite(cy) ? { c: [round1(cx), round1(cy)] } : {};
}

/** One feature's path plus the name / centroid the block's spec asks for; null if it paints nothing. */
export function bakeFeature(
  spec: BlockSpec,
  path: GeoPath,
  simplified: Feature,
  fallback: Feature,
): BakedFeature | null {
  const d = featurePath(path, simplified, fallback);
  if (!d) return null;
  return {
    id: spec.id(simplified),
    d,
    ...featureName(spec, simplified),
    ...featureCentroid(spec, path, simplified),
  };
}

/** Project → shared topology → simplify → planar paths. Pure given the atlas. */
export function bakeAtlas(spec: BlockSpec, atlas: Atlas): BakedGeometry {
  const object = atlas.objects[spec.object];
  if (!object) throw new Error(`${spec.atlas}: no object "${spec.object}"`);
  // topojson-client types feature() by the object's geometry kind; every atlas object here
  // is a GeometryCollection, so the result is a FeatureCollection.
  const full = feature(atlas, object) as unknown as FeatureCollection;
  const projection = spec.projection(full);
  // 1. Project to the block's pixel space with d3's stream pipeline (antimeridian cuts and
  //    the projection's own clipping included), exactly as geoPath(projection) would.
  const planar = geoProject(full, projection);
  // 2. Re-encode as a topology so adjacent features share arcs, then simplify those arcs
  //    once — neighbours can't drift apart or open slivers along a common border.
  //    topojson-server keeps GeoJSON's loosely typed properties; topojson-simplify wants
  //    them erased.
  const shared = topology({ shapes: planar }) as unknown as Atlas;
  const simplified = simplify(
    presimplify(shared),
    spec.minTriangleAreaPx2 ?? MIN_TRIANGLE_AREA_PX2,
  );
  const shapes = feature(simplified, simplified.objects.shapes!) as unknown as FeatureCollection;
  // 3. Emit planar path data (no projection: the coordinates already are pixels).
  const path = geoPath().digits(1);
  const features = shapes.features
    .map((f, i) => bakeFeature(spec, path, f, planar.features[i]!))
    .filter((f): f is BakedFeature => f !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { projection: readProjection(spec, projection), features };
}

/** The text between the markers. oxfmt reshapes it afterwards, so only content matters. */
export function renderBlob(name: string, spec: BlockSpec, baked: BakedGeometry): string {
  const minArea = spec.minTriangleAreaPx2 ?? MIN_TRIANGLE_AREA_PX2;
  return [
    `/* ${BEGIN} — generated by scripts/catalog/bake-map-geometry.ts, do not edit by hand.`,
    `   Source: ${spec.atlas} (object "${spec.object}"),`,
    `   projected with d3.${spec.projectionType} exactly as this block did at runtime,`,
    `   simplified in pixel space (Visvalingam, min triangle area ${minArea}px²), coordinates rounded to 0.1px.`,
    `   Regenerate: bun scripts/catalog/bake-map-geometry.ts ${name} */`,
    `var MAP_GEOMETRY = {`,
    `  projection: ${JSON.stringify(baked.projection)},`,
    `  features: [`,
    ...baked.features.map((f) => `    ${JSON.stringify(f)},`),
    `  ],`,
    `};`,
    `/* ${END} */`,
  ].join("\n");
}

/** Replace the marked region of a block with `blob`, re-indented to the region's depth. */
export function splice(html: string, name: string, blob: string): string {
  const begin = html.indexOf(`/* ${BEGIN}`);
  const endMarker = `/* ${END} */`;
  const end = html.indexOf(endMarker);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`${name}: missing ${BEGIN} / ${END} markers in the block script`);
  }
  const lineStart = html.lastIndexOf("\n", begin) + 1;
  const indent = html.slice(lineStart, begin);
  const indented = blob
    .split("\n")
    .map((line) => (line ? indent + line : line))
    .join("\n");
  return html.slice(0, lineStart) + indented + html.slice(end + endMarker.length);
}

/**
 * Format `html` the way the repo's `format:check` will, by writing it next to the block
 * and running oxfmt on that file. The formatter only takes paths, hence the round trip.
 */
function formatLikeRepo(blockFile: string, html: string): string {
  const scratch = blockFile.replace(/\.html$/, ".bake-scratch.html");
  writeFileSync(scratch, html);
  try {
    execFileSync("bunx", ["oxfmt", scratch], { stdio: "ignore" });
    return readFileSync(scratch, "utf8");
  } finally {
    rmSync(scratch, { force: true });
  }
}

async function bakeBlock(name: string, check: boolean): Promise<boolean> {
  const spec = BLOCKS[name];
  if (!spec) {
    throw new Error(`unknown map block "${name}" (known: ${Object.keys(BLOCKS).join(", ")})`);
  }
  const file = resolve(REGISTRY_BLOCKS, name, `${name}.html`);
  const html = readFileSync(file, "utf8");
  const baked = bakeAtlas(spec, await loadAtlas(spec.atlas));
  const blob = renderBlob(name, spec, baked);
  const next = formatLikeRepo(file, splice(html, name, blob));
  const summary = `${baked.features.length} features, ${blob.length} bytes`;
  if (next === html) {
    console.log(`  = ${name}: up to date (${summary})`);
    return true;
  }
  if (check) {
    console.error(
      `  ! ${name}: baked geometry is stale — run bun scripts/catalog/bake-map-geometry.ts ${name}`,
    );
    return false;
  }
  writeFileSync(file, next);
  console.log(`  ~ ${name}: baked (${summary})`);
  return true;
}

export async function main(argv: string[]): Promise<number> {
  const check = argv.includes("--check");
  const names = argv.filter((a) => !a.startsWith("--"));
  const targets = names.length ? names : Object.keys(BLOCKS);
  const results = [];
  for (const name of targets) results.push(await bakeBlock(name, check));
  return results.every(Boolean) ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
