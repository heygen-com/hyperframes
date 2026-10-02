/** Skeleton meshes only: identical extrusion/deformation, cached independently of all simulation data. */
import * as THREE from "three/webgpu";
import { extrudeShapes, loadLogoShapes } from "../shape/logo";
import { loadTypeface, textShapes, lineWidth } from "../shape/text";
import { deformGeometry } from "../shape/deform";
import { D } from "../dials/store";
const memory = new Map<string, Promise<THREE.BufferGeometry[]>>();
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const q = indexedDB.open("frost-motion-meshes", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("meshes");
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
export function skeletonMeshes(v: any, progress: (s: string) => void) {
  const key = JSON.stringify([
    "r13",
    v.logoUrl,
    v.headline1,
    v.headline2,
    v.fontWeight,
    v.textWidth,
    v.letterSpacing,
    v.textLineHeight,
    v.textDepth,
    v.textBevel,
    v.textCorner,
    v.deformStrength,
    v.deformScale,
    v.deformSeed,
    v.textMeshDetail,
    v.logoMeshDetail,
    D.shape.logo,
    D.shape.size,
  ]);
  if (memory.has(key)) return memory.get(key)!;
  const promise = (async () => {
    let db: IDBDatabase | undefined;
    try {
      db = await database();
      const packed: any = await new Promise((resolve, reject) => {
        const q = db!.transaction("meshes").objectStore("meshes").get(key);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      if (packed) {
        db.close();
        return packed.map((p: any) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(p.position, 3));
          g.setAttribute("normal", new THREE.BufferAttribute(p.normal, 3));
          g.computeBoundingBox();
          return g;
        });
      }
    } catch {}
    const P = D.shape.logo,
      fontName =
        String(v.fontWeight) === "400"
          ? "Regular"
          : String(v.fontWeight) === "700"
            ? "Bold"
            : "SemiBold";
    const [shapes, font] = await Promise.all([
      loadLogoShapes(v.logoUrl, P),
      loadTypeface(`assets/fonts/Geist-${fontName}.ttf`),
    ]);
    const geos = [extrudeShapes(shapes, P, P.width)],
      tp = {
        ...P,
        depth: v.textDepth,
        bevelThickness: v.textBevel,
        bevelSize: v.textBevel * 0.8,
        bevelOffset: 0,
        cornerRadius: v.textCorner,
        curveSegments: 10,
        bevelSegments: 4,
      };
    for (const text of [v.headline1, v.headline2]) {
      const lines = String(text)
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!lines.length) lines.push(" ");
      const size =
        v.textWidth / Math.max(0.001, ...lines.map((l) => lineWidth(font, l, v.letterSpacing)));
      geos.push(
        extrudeShapes(textShapes(font, lines, size, v.textLineHeight, v.letterSpacing), tp, size),
      );
    }
    for (let i = 0; i < 3; i++) {
      progress(`Preparing ${["logo", "first headline", "second headline"][i]} mesh…`);
      await new Promise((r) => setTimeout(r, 0));
      const old = geos[i];
      geos[i] = deformGeometry(
        old,
        { strength: v.deformStrength, scale: v.deformScale, seed: v.deformSeed },
        P.creaseAngle,
        i ? Number(v.textMeshDetail) : undefined,
        i ? undefined : Number(v.logoMeshDetail),
      );
      if (old !== geos[i]) old.dispose();
      geos[i].scale(D.shape.size, D.shape.size, D.shape.size);
    }
    if (db) {
      try {
        const tx = db.transaction("meshes", "readwrite");
        tx.objectStore("meshes").put(
          geos.map((g) => ({
            position: g.attributes.position.array,
            normal: g.attributes.normal.array,
          })),
          key,
        );
        tx.oncomplete = () => db!.close();
      } catch {
        db.close();
      }
    }
    return geos;
  })();
  memory.set(key, promise);
  promise.catch(() => memory.delete(key));
  return promise;
}
