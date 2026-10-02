/** Authored thin-film response, independent of saved workbench dial values.
 * The dials retain their values/ranges; these gains keep surface effects subordinate
 * to transmission instead of adding several opaque, white layers to the same ice.
 */
export const ICE_OPTICS = Object.freeze({
  frostVeil: 0.045,
  frostDiffuse: 0.18,
  frostRoughness: 0.22,
  smudgeDiffuse: 0.18,
  smudgeRoughness: 0.16,
  normalDetail: 0.18,
  clearcoat: 0.16,
  clearcoatRoughness: 0.22,
  specular: 0.55,
  scatterRadiance: 0.025,
});
