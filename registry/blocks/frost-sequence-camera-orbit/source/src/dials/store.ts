// FROST: the DialKit store without React / DialKit. `D` holds every folder's defaults with baked.json applied,
// resolved exactly as the experiment's resolveDefaults() does (tuple[0] / select default / plain value).
// The composition writes its hero-07 overrides into `D` once at boot and bumps `D.version`; there is no live panel.
import { MATERIAL_FEATURES } from "../ice/features";
import * as defs from "./defaults";

export type ShapeD = any;
export type IceD = any;
export type ErosionD = any;
export type PowderD = any;
export type HealingD = any;
export type LightingD = any;
export type CameraD = any;
export type PostD = any;
export type PerformanceD = any;
export type FractureD = any;
export type DebugD = any;

function resolveDefaults(cfg: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith("_")) continue;
    if (Array.isArray(v)) out[k] = v[0];
    else if (typeof v === "object" && v !== null && "type" in v) {
      const t = (v as any).type;
      if (t === "action") continue;
      out[k] = (v as any).default ?? ((v as any).options ? (v as any).options[0] : undefined);
    } else if (typeof v === "object" && v !== null) out[k] = resolveDefaults(v);
    else out[k] = v;
  }
  return out;
}

/** The store. Systems read `D.camera.fov` etc. every frame. */
export const D = {
  shape: resolveDefaults(defs.shapeDefaults),
  ice: { ...resolveDefaults(defs.iceDefaults), features: { ...MATERIAL_FEATURES } },
  erosion: resolveDefaults(defs.erosionDefaults),
  powder: resolveDefaults(defs.powderDefaults),
  healing: resolveDefaults(defs.healingDefaults),
  lighting: resolveDefaults(defs.lightingDefaults),
  camera: resolveDefaults(defs.cameraDefaults),
  post: resolveDefaults(defs.postDefaults),
  performance: resolveDefaults(defs.performanceDefaults),
  fracture: resolveDefaults(defs.fractureDefaults),
  debug: resolveDefaults(defs.debugDefaults),
  version: 0,
};

const actionListeners = new Set<(path: string) => void>();
export function onDialAction(fn: (path: string) => void) {
  actionListeners.add(fn);
  return () => {
    actionListeners.delete(fn);
  };
}
export const extraPanels: Record<string, () => any> = {};
export const toast = new EventTarget();
