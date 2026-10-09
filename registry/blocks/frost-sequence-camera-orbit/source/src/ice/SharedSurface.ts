// One surface evaluator for intact ice and detached shards. No independent finish.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
import { rng } from "../core/seed";
import { ErosionField } from "../erosion/ErosionField";
import { iceFrost } from "./SurfaceDetail";
import { fbm, gnoise, vnoise3, softThreshold, saturate, voronoiEdge } from "../tsl/noise";
const { Fn, If, vec3, vec4, float, dot, smoothstep, normalize, clamp, dFdx, dFdy, length, max } =
  tsl;
type N = any;
export function iceSmudgeDirections(seed: number) {
  const rand = rng(seed + 11);
  return [0, 1, 2].map(() => {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    return vec3(v.x, v.y, v.z);
  });
}
export function iceSurface(
  p: N,
  nBase: N,
  seedV: N,
  smudgeDirs: N[],
  erosion: any,
  u: any,
  f: any,
  filter = false,
) {
  const band = (scale: N) =>
    filter
      ? float(1).sub(
          smoothstep(0.35, 1.25, max(length(dFdx(p.mul(scale))), length(dFdy(p.mul(scale))))),
        )
      : float(1);
  // frost
  // Sample at the visible solid hit, consistently before and during breakup.
  const frost0 = iceFrost(p, seedV, u.frostScale, u.frostThreshold, u.frostSoftness);
  const frost = saturate(frost0.add(u.interiorFrost)).mul(f.frost);

  // smudges: anisotropic streaks in 3 directions + blotchy prints (evaluated at the solid hit)
  const stretch = (q: N, d: N) =>
    q.sub(d.mul(dot(q, d)).mul(float(1).sub(float(1).div(u.smudgeAniso))));
  const smudgeNoise = vec4(
    gnoise(stretch(p.mul(u.smudgeScale), smudgeDirs[0]).add(seedV.mul(3))),
    gnoise(stretch(p.mul(u.smudgeScale), smudgeDirs[1]).add(seedV.mul(4))),
    gnoise(stretch(p.mul(u.smudgeScale), smudgeDirs[2]).add(seedV.mul(5))),
    gnoise(p.mul(u.smudgeScale.mul(1.7)).add(seedV.mul(7.0))),
  );
  const streaks = smoothstep(0.45, 0.85, smudgeNoise.x.mul(0.5).add(0.5))
    .add(smoothstep(0.45, 0.85, smudgeNoise.y.mul(0.5).add(0.5)))
    .add(smoothstep(0.45, 0.85, smudgeNoise.z.mul(0.5).add(0.5)));
  const blotch = smoothstep(0.6, 0.72, smudgeNoise.w.mul(0.5).add(0.5));
  // noise masks: where smudges / micro bumps / cracks apply (low frequency)
  const maskNoise = vec3(
    fbm(p.mul(u.smudgeMaskScale).add(seedV.mul(21.0)), 2)
      .mul(0.5)
      .add(0.5),
    fbm(p.mul(u.bumpMaskScale).add(seedV.mul(27.0)), 2)
      .mul(0.5)
      .add(0.5),
    fbm(p.mul(u.regionScale).add(seedV.mul(33.0)), 2)
      .mul(0.5)
      .add(0.5),
  );
  const smudgeMask = softThreshold(maskNoise.x, float(1).sub(u.smudgeCoverage), 0.35);
  const microMask = softThreshold(maskNoise.y, float(1).sub(u.microCoverage), 0.35);
  const regionMask = softThreshold(maskNoise.z, float(1).sub(u.regionCoverage), 0.45);
  const smudge = saturate(
    streaks.div(3).add(blotch.mul(0.6)).mul(u.smudgeAmount).mul(smudgeMask),
  ).mul(f.smudges);

  // surface cracks (distance to the nearest Voronoi boundary at the surface)
  const crackHelper = erosion.sampleCrack(p);
  const warpedP = ErosionField.warpDomain(p, crackHelper.xyz, u.crackLarge, u.crackWarp).add(
    seedV.mul(0.37),
  );
  const ve = Fn(() => {
    const edge = vec4(0, 0, 1, 1).toVar();
    If(f.cracks.greaterThan(0.5), () => {
      edge.assign(
        erosion.materialPlanes
          ? erosion.materialPlanes.sample(warpedP)
          : voronoiEdge(warpedP, u.seed, u.crackCoverage),
      );
    });
    return edge;
  })();
  const dEdge = ve.w.div(u.crackLarge);
  const veinSurf = float(1).sub(
    u.veinContrast.mul(
      fbm(p.mul(u.veinScale).add(seedV.mul(41.0)), 2)
        .mul(0.5)
        .add(0.5),
    ),
  );
  const surfCrack = smoothstep(u.crackWidth.mul(5.0), 0.0, dEdge)
    .mul(u.surfaceCrack)
    .mul(regionMask)
    .mul(veinSurf)
    .mul(f.cracks);

  // Independent normal layers; none is activated by the breakup field.
  const topness = saturate(nBase.y.mul(0.5).add(0.5));
  const crystals = vnoise3(p.mul(u.crystalScale).add(seedV))
    .mul(u.crystalBump)
    .mul(0.6)
    .mul(f.crystals)
    .mul(band(u.crystalScale));
  const grain = vnoise3(p.mul(u.edgeBumpScale).add(seedV.mul(13.0)))
    .mul(u.edgeBump)
    .mul(0.5)
    .mul(f.grain)
    .mul(band(u.edgeBumpScale));
  const micro = vnoise3(p.mul(u.microScale).add(seedV.mul(5.0)))
    .mul(u.microBump)
    .mul(microMask)
    .mul(f.micro)
    .mul(band(u.microScale));
  const ripple = vnoise3(p.mul(u.rippleScale).add(seedV.mul(9.0)))
    .mul(u.rippleBump)
    .mul(topness)
    .mul(f.ripples)
    .mul(band(u.rippleScale));
  // The master switch removes normal perturbations without discarding their saved
  // strengths, crack colour, frost coverage or genuine fracture-face normals.
  const detailNormal = crystals
    .add(grain)
    .sub(micro)
    .sub(ripple)
    .sub(ve.xyz.mul(surfCrack).mul(0.6));
  const nSurface = normalize(nBase.add(detailNormal.mul(f.surfaceBumps)));
  return {
    frost,
    smudge,
    surfCrack,
    nSurface,
    regionMask,
    roughness: clamp(
      u.baseRough
        .add(frost.mul(u.frostRough))
        .add(smudge.mul(u.smudgeRough))
        .add(surfCrack.mul(0.12)),
      0.015,
      0.8,
    ),
  };
}
