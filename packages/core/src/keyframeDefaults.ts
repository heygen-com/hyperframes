// A prop absent here has no safe static default; each caller decides how to treat it.
export const KEYFRAME_PROPERTY_DEFAULTS: Readonly<Record<string, number>> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  width: 100,
  height: 100,
};
