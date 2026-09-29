// FROST: an IndexedDB cache for the expensive, deterministic build products (extruded geometries, distance
// fields, grain homes), keyed by everything that shapes them. A reload with the same headlines and type
// settings skips the voxelisation; the entry is dropped automatically when the key changes.
import * as THREE from "three/webgpu";

const DB = "frost-build-cache",
  STORE = "builds",
  VERSION = 1;
/** bump when the build pipeline changes in a way that makes old entries wrong */
export const BUILD_VERSION = "frost-build-10-planar-cap-normals";

export interface CachedGeometry {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array | null;
  index: Uint32Array | null;
}
export interface CachedBuild {
  geometries: CachedGeometry[];
  sdfs: {
    data: Float32Array;
    res: number;
    bound: number;
    thickness: number;
    sampleBound: number;
  }[];
  rests: Float32Array[];
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readBuild(key: string): Promise<CachedBuild | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CachedBuild) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeBuild(key: string, build: CachedBuild): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear(); // one entry: the current build
      store.put(build, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function packGeometry(g: THREE.BufferGeometry): CachedGeometry {
  const a = (name: string) =>
    g.attributes[name] ? (g.attributes[name].array as Float32Array) : null;
  return {
    position: a("position")!,
    normal: a("normal")!,
    uv: a("uv"),
    index: g.index ? new Uint32Array(g.index.array as ArrayLike<number>) : null,
  };
}

export function unpackGeometry(c: CachedGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(c.position, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(c.normal, 3));
  if (c.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(c.uv, 2));
  if (c.index) g.setIndex(new THREE.BufferAttribute(c.index, 1));
  g.computeBoundingBox();
  return g;
}
