/** Text-only mesh density. Priority edge bisection spends a strict budget on the longest
 * remaining edges; every incident face splits together, including cap/bevel/side seams. */
import preset from "../../presets/approved-material.json";
export const TEXT_MESH_DETAIL_DEFAULT = preset.textMeshDetail;
export function resolveTextMeshDetail(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(4, Math.round(value)))
    : TEXT_MESH_DETAIL_DEFAULT;
}
export function textRefinementSettings(scale: number, detail: number) {
  const level = resolveTextMeshDetail(detail);
  return { maxEdge: scale / (2 * level), extraTriangles: 160_000 * level };
}
type Edge = { a: number; b: number; length2: number; faces: Set<number> };
/** Exported for measurement before displacement; positions gain shared midpoint vertices. */
export function refineText(
  positions: number[],
  initial: number[],
  maxEdge: number,
  extraTriangles: number,
) {
  const triangles: (number[] | null)[] = [],
    edges = new Map<string, Edge>(),
    heap: Edge[] = [];
  const max2 = maxEdge * maxEdge,
    limit = initial.length / 3 + extraTriangles;
  let count = initial.length / 3;
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const better = (a: Edge, b: Edge) =>
    a.length2 > b.length2 || (a.length2 === b.length2 && (a.a < b.a || (a.a === b.a && a.b < b.b)));
  function push(edge: Edge) {
    let i = heap.length;
    heap.push(edge);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!better(edge, heap[parent])) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = edge;
  }
  function pop() {
    const best = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && better(heap[child + 1], heap[child])) child++;
        if (!better(heap[child], last)) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return best;
  }
  function add(a: number, b: number, c: number) {
    const id = triangles.length;
    triangles.push([a, b, c]);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = key(u, v);
      let edge = edges.get(k);
      if (!edge) {
        const dx = positions[u * 3] - positions[v * 3],
          dy = positions[u * 3 + 1] - positions[v * 3 + 1],
          dz = positions[u * 3 + 2] - positions[v * 3 + 2];
        edge = {
          a: Math.min(u, v),
          b: Math.max(u, v),
          length2: dx * dx + dy * dy + dz * dz,
          faces: new Set(),
        };
        edges.set(k, edge);
        if (edge.length2 > max2) push(edge);
      }
      edge.faces.add(id);
    }
  }
  function remove(id: number) {
    const t = triangles[id]!;
    triangles[id] = null;
    for (let j = 0; j < 3; j++) {
      const k = key(t[j], t[(j + 1) % 3]),
        e = edges.get(k)!;
      e.faces.delete(id);
      if (!e.faces.size) edges.delete(k);
    }
  }
  for (let i = 0; i < initial.length; i += 3) add(initial[i], initial[i + 1], initial[i + 2]);
  while (heap.length && count < limit) {
    const edge = pop();
    if (edges.get(key(edge.a, edge.b)) !== edge) continue;
    const ids = [...edge.faces];
    if (count + ids.length > limit) continue;
    const m = positions.length / 3;
    positions.push(
      (positions[edge.a * 3] + positions[edge.b * 3]) / 2,
      (positions[edge.a * 3 + 1] + positions[edge.b * 3 + 1]) / 2,
      (positions[edge.a * 3 + 2] + positions[edge.b * 3 + 2]) / 2,
    );
    const faces = ids.map((id) => triangles[id]!);
    for (const id of ids) remove(id);
    for (const t of faces) {
      // Retain original winding, regardless of which side sees a->b versus b->a.
      const j = t.findIndex((v, j) => key(v, t[(j + 1) % 3]) === key(edge.a, edge.b));
      const a = t[j],
        b = t[(j + 1) % 3],
        c = t[(j + 2) % 3];
      add(a, m, c);
      add(m, b, c);
    }
    count += ids.length;
  }
  const out: number[] = [];
  for (const t of triangles) if (t) out.push(t[0], t[1], t[2]);
  return out;
}

/** Repair subpixel extrusion seam duplicates before subdividing them. Only boundary
 * vertices are eligible; real glyph contours/counters and the SVG path are untouched. */
export function repairTextSeams(positions: number[], indices: number[]) {
  const clean: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3);
    if (a !== b && b !== c && c !== a) clean.push(a, b, c);
  }
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < clean.length; i += 3)
    for (const [a, b] of [
      [clean[i], clean[i + 1]],
      [clean[i + 1], clean[i + 2]],
      [clean[i + 2], clean[i]],
    ]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`,
        edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  const boundary = new Set<number>();
  for (const e of edges.values())
    if (e.count === 1) {
      boundary.add(e.a);
      boundary.add(e.b);
    }
  const eps = 1e-5,
    grid = new Map<string, number[]>(),
    remap = new Map<number, number>();
  for (const v of [...boundary].sort((a, b) => a - b)) {
    const x = positions[v * 3],
      y = positions[v * 3 + 1],
      z = positions[v * 3 + 2],
      cx = Math.floor(x / eps),
      cy = Math.floor(y / eps),
      cz = Math.floor(z / eps);
    let representative = v;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const other of grid.get(`${cx + dx}:${cy + dy}:${cz + dz}`) || []) {
            if (
              Math.hypot(
                x - positions[other * 3],
                y - positions[other * 3 + 1],
                z - positions[other * 3 + 2],
              ) <= eps
            )
              representative = Math.min(representative, other);
          }
    remap.set(v, representative);
    if (representative === v) {
      const key = `${cx}:${cy}:${cz}`,
        bucket = grid.get(key) || [];
      bucket.push(v);
      grid.set(key, bucket);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 3) {
    const [a, b, c] = clean.slice(i, i + 3).map((v) => remap.get(v) ?? v);
    if (a !== b && b !== c && c !== a) out.push(a, b, c);
  }
  return out;
}
