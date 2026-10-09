// Resolve all overlapping filled regions before extrusion: one boundary per solid.
import * as THREE from "three/webgpu";
import Clipper from "../vendor/clipper.cjs";
const C: any = Clipper,
  SCALE = 1e6;
export function unionOutlines(shapes: THREE.Shape[], segments = 24): THREE.Shape[] {
  const paths: any[] = [];
  for (const shape of shapes) {
    for (const [i, ring] of [shape, ...shape.holes].entries()) {
      const points = ring
        .getPoints(segments)
        .map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
      if (points.length < 3) continue;
      // Nonzero filling adds solids and subtracts holes; overlapping solids do not XOR.
      if (C.Clipper.Orientation(points) !== (i === 0)) points.reverse();
      paths.push(points);
    }
  }
  const clipper = new C.Clipper();
  clipper.StrictlySimple = true;
  clipper.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  clipper.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const result: THREE.Shape[] = [];
  const pts = (node: any) =>
    node.Contour().map((p: any) => new THREE.Vector2(p.X / SCALE, p.Y / SCALE));
  const walk = (node: any) => {
    for (const child of node.Childs()) {
      if (!child.IsHole()) {
        const shape = new THREE.Shape(pts(child));
        shape.holes = child
          .Childs()
          .filter((h: any) => h.IsHole())
          .map((h: any) => new THREE.Path(pts(h)));
        result.push(shape);
      }
      walk(child);
    }
  };
  walk(tree);
  return result;
}
