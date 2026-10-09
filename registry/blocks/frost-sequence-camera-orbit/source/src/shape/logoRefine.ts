import type * as THREE from "three/webgpu";
import preset from "../../presets/approved-material.json";
export const LOGO_MESH_DETAIL_DEFAULT = preset.logoMeshDetail;
export function resolveLogoMeshDetail(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(4, Math.round(value)))
    : LOGO_MESH_DETAIL_DEFAULT;
}
/** Use a physical surface target, independent of contour sampling and tiny noise sizes.
 * Long caps and side faces share the same threshold; already short bevel edges stay put. */
export function logoRefinementSettings(source: THREE.BufferGeometry, detail: number) {
  source.computeBoundingBox();
  const b = source.boundingBox!;
  const width = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 0.001),
    level = resolveLogoMeshDetail(detail);
  return { maxEdge: width / (32 * level), extraTriangles: 160_000 * level };
}
