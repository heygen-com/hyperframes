import { RW } from "../rewrite";
import { fastOptics } from "./FastOptics";
// One ice material evaluated at the bounded volume hit. Optical features are live,
// independently switchable uniforms; erosion only changes the visible geometry.
// Exposes { material, uniforms, update } — every uniform is driven from DialKit each frame.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
const {
  Fn,
  vec3,
  vec4,
  float,
  uniform,
  varying,
  texture,
  vec2,
  positionLocal,
  normalLocal,
  cameraPosition,
  transformNormalToView,
  normalize,
  dot,
  length,
  max,
  min,
  abs,
  pow,
  exp,
  mix,
  smoothstep,
  clamp,
  reflect,
  select,
  If,
  Loop,
  Break,
  int,
  output,
  screenUV,
} = tsl;
import type { ShapeSpec } from "../shape/sdf";
import { ErosionField } from "../erosion/ErosionField";
import {
  fbm,
  gnoise,
  vnoise3,
  hash31,
  voronoiCell,
  voronoiCell8,
  voronoiEdge,
  softThreshold,
  saturate,
} from "../tsl/noise";
import { D } from "../dials/store";
import { rng } from "../core/seed";
import { ICE_VARIANT } from "./variant";
import { opticalTransport } from "./OpticalTransport";
import { iceSurface, iceSmudgeDirections } from "./SharedSurface";
import { iceDetail, iceFrost, iceInclusions } from "./SurfaceDetail";
import { MATERIAL_FEATURES } from "./features";

type N = any;

export interface IceMaterialOptions {
  shape: ShapeSpec;
  erosion: ErosionField;
  seed: number;
  blueNoise: THREE.Texture;
  dispersion?: boolean;
  voronoiCells?: "27" | "8";
  environment?: THREE.Texture;
  fractureDetail?: THREE.Texture;
  backdrop?: any;
  meshEntry?: any;
  glassMatcap?: any;
}
export interface IceMaterialBundle {
  material: THREE.MeshPhysicalNodeMaterial;
  uniforms: Record<string, any>;
  features: Record<string, any>;
  update(
    t: number,
    dt: number,
    keyLight: THREE.DirectionalLight,
    objectGroup: THREE.Object3D,
  ): void;
}

let frameCounter = 0;
// HyperFrames adapter: keep the original deterministic frame clock.
let frameIndexOverride = -1;
export function setIceFrameIndex(index: number) {
  frameIndexOverride = index;
}

export function createIceMaterial({
  shape,
  erosion,
  seed,
  environment,
  fractureDetail,
  backdrop,
  meshEntry,
  glassMatcap,
  voronoiCells = "27",
}: IceMaterialOptions): IceMaterialBundle {
  const voro = voronoiCells === "8" ? voronoiCell8 : voronoiCell;
  const rand = rng(seed + 11);
  const u = {
    model: uniform(new THREE.Matrix4()),
    envStrength: uniform(1),
    backlight: uniform(0.4),
    inclusionAmount: uniform(0.3),
    inclusionScale: uniform(0.4),
    baseColor: uniform(new THREE.Color("#f8f8f8")),
    ior: uniform(1.36),
    dispersion: uniform(0.02),
    thicknessScale: uniform(1),
    attDist: uniform(0.9),
    attColor: uniform(new THREE.Color("#cfd2d4")),
    baseRough: uniform(0.05),
    frostScale: uniform(1.6),
    frostThreshold: uniform(0.5),
    frostSoftness: uniform(0.28),
    frostRough: uniform(0.65),
    frostDiffuse: uniform(0.55),
    crystalBump: uniform(0.12),
    crystalScale: uniform(28),
    crackLarge: uniform(1.6),
    crackWarp: uniform(0.45),
    crackCoverage: uniform(0.55),
    regionScale: uniform(0.8),
    regionCoverage: uniform(0.7),
    veinScale: uniform(5),
    veinContrast: uniform(0.7),
    crackFine: uniform(5.5),
    crackFineAmount: uniform(0.45),
    fineCoverage: uniform(0.35),
    fineNearLarge: uniform(0.75),
    crackWidth: uniform(0.004),
    crackBright: uniform(0.4),
    crackDark: uniform(0.5),
    crackRefr: uniform(0.02),
    surfaceCrack: uniform(0.35),
    crackSteps: uniform(14),
    smudgeAmount: uniform(0.6),
    smudgeCoverage: uniform(0.55),
    smudgeMaskScale: uniform(1.2),
    smudgeAniso: uniform(6),
    smudgeRough: uniform(0.35),
    smudgeWhite: uniform(0.08),
    smudgeScale: uniform(3.2),
    microBump: uniform(0.25),
    microScale: uniform(60),
    microCoverage: uniform(0.6),
    rippleBump: uniform(0.3),
    rippleScale: uniform(9),
    bumpMaskScale: uniform(1.5),
    clearcoat: uniform(0.3),
    clearcoatRough: uniform(0.08),
    specularIntensity: uniform(1),
    interiorScatter: uniform(0.25),
    deformAmp: uniform(0.045),
    deformFreq: uniform(1.1),
    seed: uniform(seed),
    edgeWidth: uniform(0.35),
    edgeInset: uniform(0.06),
    edgeBump: uniform(0.6),
    edgeBumpScale: uniform(55),
    refrostStrength: uniform(1),
    cutThreshold: uniform(0.7),
    cutSoft: uniform(0.04),
    interiorSteps: uniform(24),
    interiorFrost: uniform(0),
    crumbleGlow: uniform(0.15),
    edgeWhite: uniform(0.5),
    lightDir: uniform(new THREE.Vector3(0, 1, 0)),
    modelInv: uniform(new THREE.Matrix4()),
    jitter: uniform(new THREE.Vector2()),
    adaptiveSteps: uniform(0),
    powderTone: uniform(new THREE.Color("#dcdcdc")),
    keyIntensity: uniform(3.2),
    keyColor: uniform(new THREE.Color("#ffffff")),
    hover: uniform(0),
  };
  const f = Object.fromEntries(
    Object.keys(MATERIAL_FEATURES).map((name) => [name, uniform(Number(MATERIAL_FEATURES[name]))]),
  ) as Record<string, any>;
  const seedV = vec3(seed * 0.731, seed * 0.137, seed * 0.529);
  const smudgeDirs = iceSmudgeDirections(seed);

  const material: any = RW.matcap
    ? new THREE.MeshBasicNodeMaterial()
    : new THREE.MeshPhysicalNodeMaterial();
  const lightDir = new THREE.Vector3();
  const objectRotation = new THREE.Quaternion();
  let settingsVersion = -1;
  // Render the existing raymarched solid-ice path directly. DoubleSide draws
  // this back-face proxy first, then covers it with the separate front-shell
  // finish until the erosion sweep discards that shell. BackSide keeps the
  // original interior shading and exposes it from the intact first frame.
  // cutRes still finds the first remaining solid along the ray; cutHit discards
  // the proxy when that ray contains no ice, including during assembly/breakup.
  material.side = THREE.BackSide;
  material.transparent = false;
  material.metalness = 0;
  material.transmission = 1; // enables the transmission pass; the node below drives the value

  // ---------- vertex: deformation + erosion inset + crack notches
  const deformAt = (p: N) => fbm(p.mul(u.deformFreq).add(seedV), 3).mul(u.deformAmp);
  // crumbly edge band just below the cut threshold
  const edgeBandOf = (er: N) =>
    smoothstep(u.cutThreshold.sub(u.edgeWidth), u.cutThreshold.sub(u.edgeWidth.mul(0.15)), er);
  const displaced = Fn(() => {
    const p = positionLocal,
      n = normalLocal;
    const d = deformAt(p);
    const er = erosion.sample(p).r;
    const edge = edgeBandOf(er);
    const notch = erosion
      .sampleCrack(p)
      .w.mul(u.surfaceCrack)
      .mul(f.cracks)
      .mul(f.surfaceBumps)
      .mul(0.012);
    return p.add(n.mul(d.sub(edge.mul(u.edgeInset)).sub(notch)));
  })();
  material.positionNode = displaced;
  const vPos = varying(displaced);

  // ---------- one material, evaluated at the first remaining solid on the ray
  const camObj = u.modelInv.mul(vec4(cameraPosition, 1.0)).xyz;
  const V = normalize(vPos.sub(camObj));
  const L = u.lightDir;
  const meshPosition = meshEntry?.position.sample(screenUV);
  const meshNormal = meshEntry?.normal.sample(screenUV).xyz;
  const meshValid = meshEntry
    ? meshEntry.depth
        .sample(screenUV)
        .r.lessThan(0.999999)
        .and(erosion.sample(meshPosition.xyz).r.lessThan(u.cutThreshold))
    : null;
  const cutRes = Fn(() => {
    const ro = camObj;
    // The voxel SDF clamps to its border outside [-bound, bound]. Those values
    // are not distances from the camera: marching from t=0 can jump across the
    // entire thin logo/text and leave cutHit=-1. Enter the texture's valid box
    // analytically before sampling, and never search beyond the proxy surface.
    const reciprocal = (d: N) =>
      select(d.greaterThanEqual(0), float(1), float(-1)).div(max(abs(d), 1e-6));
    const invRay = vec3(reciprocal(V.x), reciprocal(V.y), reciprocal(V.z));
    const a = vec3(-shape.bound).sub(ro).mul(invRay);
    const b = vec3(shape.bound).sub(ro).mul(invRay);
    const near = min(a, b),
      far = max(a, b);
    const tStart = max(max(near.x, max(near.y, near.z)), 0);
    const tMax = min(min(far.x, min(far.y, far.z)), length(vPos.sub(camObj)));
    const result = vec4(vPos, -1).toVar();
    if (meshEntry)
      If(meshValid, () => {
        result.assign(vec4(meshPosition.xyz, length(meshPosition.xyz.sub(camObj))));
      });
    If(tMax.greaterThan(tStart).and(result.w.lessThan(0)), () => {
      // Raster coverage already establishes the exact mesh silhouette. The
      // interpolated voxel field has a finite surface error, especially in thin
      // rotating glyphs. A strict negative-distance test clipped their far edge.
      const voxel = float((2 * erosion.bound) / erosion.res);
      const surfaceVoxel = shape.voxelSize ?? voxel;
      const shell = surfaceVoxel.mul(0.4);
      const t = tStart.toVar();
      Loop(192, () => {
        If(t.greaterThan(tMax), () => {
          Break();
        });
        const q = ro.add(V.mul(t));
        const d = shape.sdfNode(q);
        If(d.lessThanEqual(0.001).and(erosion.sample(q).r.lessThan(u.cutThreshold)), () => {
          result.assign(vec4(q, t));
          Break();
        });
        // Conservative steps near the surface and through cut-away ice; no
        // whole-chord subsampling that can step across a thin surviving glyph.
        t.addAssign(max(d.sub(shell).mul(0.7), surfaceVoxel.mul(0.35)));
      });
      // The rasterized far surface is an exact endpoint, even when the voxel
      // SDF misses a bevel. Only accept it when the same erosion field is solid.
      If(result.w.lessThan(0).and(erosion.sample(vPos).r.lessThan(u.cutThreshold)), () => {
        result.assign(vec4(vPos, tMax));
      });
    });
    return result;
  })();
  const cutHit = cutRes.w;
  const cutPos = cutRes.xyz;
  // outward normal of the solid at the cut: erosion gradient (points into the void), else the shell normal
  const ge = 0.02;
  const cutGrad = vec3(
    erosion.sample(cutPos.add(vec3(ge, 0, 0))).r.sub(erosion.sample(cutPos.sub(vec3(ge, 0, 0))).r),
    erosion.sample(cutPos.add(vec3(0, ge, 0))).r.sub(erosion.sample(cutPos.sub(vec3(0, ge, 0))).r),
    erosion.sample(cutPos.add(vec3(0, 0, ge))).r.sub(erosion.sample(cutPos.sub(vec3(0, 0, ge))).r),
  );
  const cutGradLen = length(cutGrad);
  // Shade the actual hit surface, not the proxy's far wall.
  const shapeEpsilon = shape.voxelSize ? shape.voxelSize.mul(0.75) : float(ge);
  const shapeGrad = vec3(
    shape
      .sdfNode(cutPos.add(vec3(shapeEpsilon, 0, 0)))
      .sub(shape.sdfNode(cutPos.sub(vec3(shapeEpsilon, 0, 0)))),
    shape
      .sdfNode(cutPos.add(vec3(0, shapeEpsilon, 0)))
      .sub(shape.sdfNode(cutPos.sub(vec3(0, shapeEpsilon, 0)))),
    shape
      .sdfNode(cutPos.add(vec3(0, 0, shapeEpsilon)))
      .sub(shape.sdfNode(cutPos.sub(vec3(0, 0, shapeEpsilon)))),
  );
  const sdfNormal = () =>
    select(
      length(shapeGrad).greaterThan(1e-5),
      shapeGrad.div(max(length(shapeGrad), 1e-5)),
      normalLocal.negate(),
    );
  const shapeNormal = meshEntry
    ? Fn(() => {
        const n = vec3(0).toVar();
        If(meshValid, () => n.assign(normalize(meshNormal))).Else(() => n.assign(sdfNormal()));
        return n;
      })()
    : sdfNormal();
  const nBase = normalize(
    mix(
      shapeNormal,
      cutGrad.div(max(cutGradLen, 1e-5)),
      smoothstep(0.02, 0.15, cutGradLen).mul(f.cutNormals),
    ),
  );
  const p = cutPos;
  const { frost, smudge, surfCrack, nSurface, regionMask, roughness } = iceSurface(
    p,
    nBase,
    seedV,
    smudgeDirs,
    erosion,
    u,
    f,
    RW.aa,
  );
  // The back-face proxy is flipped by Three; supply the opposite normal.
  material.normalNode = transformNormalToView(nSurface.negate());
  const tExit = length(vPos.sub(cutPos));

  // Sparse hairline fissures at several depths. Cell transitions used to shade
  // entire planes, covering the transparent windows with white polygon tiles.
  // Evaluate actual distance to each fissure instead; energy is bounded and
  // normalized so extra sampling cannot turn the whole volume opaque.
  const march = Fn(() => {
    const glint = float(0).toVar();
    const steps = clamp(u.crackSteps.div(4).floor(), 2, 6).toVar();
    Loop({ start: int(0), end: int(steps), type: "int", condition: "<" }, ({ i }: any) => {
      const depth = float(i).add(0.5).div(steps);
      const q = cutPos.add(V.mul(tExit).mul(depth)).toVar();
      const helper = erosion.sampleCrack(q);
      const qw = ErosionField.warpDomain(q, helper.xyz, u.crackLarge, u.crackWarp).add(
        seedV.mul(0.37),
      );
      const edge = (erosion as any).materialPlanes
        ? (erosion as any).materialPlanes.sample(qw)
        : voronoiEdge(qw, u.seed, u.crackCoverage);
      const width = max(u.crackWidth.mul(u.crackLarge), 0.001);
      const fissure = float(1).sub(smoothstep(width, width.mul(2.5), edge.w));
      const vein = float(1).sub(
        u.veinContrast.mul(
          fbm(q.mul(u.veinScale).add(seedV.mul(41)), 2)
            .mul(0.5)
            .add(0.5),
        ),
      );
      const fineEdge = (erosion as any).materialPlanes
        ? (erosion as any).materialPlanes.sample(
            qw.mul(u.crackFine.div(u.crackLarge)).add(seedV),
            true,
          )
        : voronoiEdge(
            qw.mul(u.crackFine.div(u.crackLarge)).add(seedV),
            u.seed.add(7),
            u.fineCoverage,
          );
      const fineWidth = max(u.crackWidth.mul(u.crackFine).mul(0.35), 0.001);
      const branch = float(1).sub(smoothstep(fineWidth, fineWidth.mul(2.5), fineEdge.w));
      const nearLarge = mix(
        float(1),
        float(1).sub(smoothstep(0.03, 0.25, edge.w)),
        u.fineNearLarge,
      );
      const feather = smoothstep(0.24, 0.68, fbm(q.mul(38).add(seedV), 2).mul(0.5).add(0.5));
      const filaments = fissure.mul(feather).add(branch.mul(u.crackFineAmount).mul(nearLarge));
      const solid = smoothstep(0.85, 0.35, erosion.sample(q).r);
      const illumination = abs(dot(edge.xyz, L)).mul(0.6).add(0.4);
      glint.addAssign(
        filaments
          .mul(vein)
          .mul(regionMask)
          .mul(solid)
          .mul(illumination)
          .mul(exp(depth.mul(tExit).div(max(u.attDist, 0.01)).negate())),
      );
    });
    const density = clamp(glint.div(steps), 0, 1);
    return vec4(density.mul(u.crackBright), float(1).sub(density.mul(u.crackDark).mul(0.15)), 0, 0);
  })();
  const m = Fn(() => {
    const result = vec4(0, 1, 0, 0).toVar();
    If(f.cracks.greaterThan(0.5), () => {
      result.assign(march);
    });
    return result;
  })();

  // Clear dielectric first. The seven surface layers remain independent and sparse.
  // Surface frost mostly broadens reflection; it must not turn the whole volume white.
  const opticalPath = max(tExit.mul(u.thicknessScale), 0.001);
  const densityAt = (q: N, depth: N) =>
    iceDetail(fractureDetail, q, nBase, u.inclusionScale, depth);
  const inclusions =
    ICE_VARIANT === "photographic"
      ? iceInclusions(fractureDetail, p, nBase, V, tExit, u.inclusionScale, u.inclusionAmount).mul(
          f.scatter,
        )
      : float(0);
  const frostCover = clamp(
    frost.mul(u.frostDiffuse).add(smudge.mul(u.smudgeWhite)).add(inclusions.mul(0.65)),
    0,
    0.65,
  );
  const surfaceDetail =
    ICE_VARIANT === "photographic" ? densityAt(p, float(0)).mul(f.frost) : float(0);
  material.roughnessNode = clamp(roughness.add(surfaceDetail.mul(0.22)), 0.015, 0.8);
  material.iorNode = u.ior;
  material.dispersionNode = u.dispersion.mul(f.dispersion);
  material.thicknessNode = opticalPath;
  material.attenuationDistanceNode = max(u.attDist, 0.01);
  material.attenuationColorNode = mix(vec3(1), u.attColor, f.absorption);
  material.colorNode = u.baseColor;
  material.clearcoatNode = u.clearcoat.mul(f.clearcoat);
  material.clearcoatRoughnessNode = u.clearcoatRough;
  material.specularIntensityNode = u.specularIntensity.mul(f.reflections);
  const volumeGlint = m.x.add(surfCrack.mul(0.3)).mul(u.keyIntensity).mul(0.3);
  const scatter = frostCover.mul(u.interiorScatter).mul(f.scatter);
  material.emissiveNode = u.keyColor.mul(volumeGlint.add(scatter.mul(0.3)));
  if (RW.matcap) {
    const nv = normalize(transformNormalToView(nSurface)),
      uv = nv.xy.mul(0.495).add(0.5);
    const spread = roughness.mul(roughness).mul(0.06),
      capSample = (v: N) => texture(glassMatcap, clamp(v, 0.002, 0.998)).rgb;
    const cap = capSample(uv)
      .mul(0.4)
      .add(capSample(uv.add(vec2(spread, 0))).mul(0.15))
      .add(capSample(uv.sub(vec2(spread, 0))).mul(0.15))
      .add(capSample(uv.add(vec2(0, spread))).mul(0.15))
      .add(capSample(uv.sub(vec2(0, spread))).mul(0.15))
      .mul(u.envStrength);
    material.outputNode = Fn(() => {
      cutHit.lessThan(0).discard();
      const cover = max(frostCover, float(1).sub(f.transmission));
      const frosted = u.baseColor.mul(cap.mul(0.5).add(vec3(0.2)).mul(u.keyIntensity));
      return vec4(
        mix(cap.mul(m.y), frosted, cover)
          .add(u.keyColor.mul(volumeGlint))
          .add(u.keyColor.mul(inclusions.mul(u.backlight).mul(0.8))),
        1,
      );
    })();
  } else if (ICE_VARIANT === "physical") {
    material.transmissionNode = f.transmission.mul(float(1).sub(frostCover));
    material.outputNode = Fn(() => {
      cutHit.lessThan(0).discard();
      return vec4(output.rgb.mul(m.y), output.a);
    })();
  } else {
    const optical = RW.fast
      ? fastOptics({ ray: V, normal: nSurface, environment, u, f, roughness, path: tExit })
      : opticalTransport({
          shape,
          erosion,
          p,
          ray: V,
          normal: nSurface,
          environment,
          backdrop,
          u,
          f,
          roughness,
        });
    // Keep physical lighting for the frosted fraction; custom transport owns the clear fraction.
    material.transmission = 0;
    material.transmissionNode = null;
    material.outputNode = Fn(() => {
      cutHit.lessThan(0).discard();
      const clear = optical.reflected.add(optical.transmitted.mul(m.y));
      const cover = max(frostCover, float(1).sub(f.transmission));
      const lit = clear.mul(float(1).sub(cover)).add(output.rgb.mul(cover));
      const frozenLight = u.keyColor.mul(inclusions.mul(u.backlight).mul(0.8));
      return vec4(lit.add(frozenLight).add(u.keyColor.mul(volumeGlint)), 1);
    })();
  }

  function update(
    _t: number,
    _dt: number,
    keyLight: THREE.DirectionalLight,
    objectGroup: THREE.Object3D,
  ) {
    if (D.version !== settingsVersion) {
      settingsVersion = D.version;
      const I = D.ice,
        E = D.erosion,
        S = D.shape,
        H = D.healing;
      for (const name of Object.keys(f))
        f[name].value = Number(I.features?.[name] ?? MATERIAL_FEATURES[name]);
      u.baseColor.value.set(I.baseColor ?? "#ffffff");
      u.envStrength.value = I.envIntensity;
      u.backlight.value = I.backlight ?? 0.4;
      u.inclusionAmount.value = I.inclusionAmount ?? 0.3;
      u.inclusionScale.value = I.inclusionScale ?? 0.4;
      u.ior.value = I.ior;
      u.dispersion.value = I.dispersion;
      u.thicknessScale.value = I.thicknessScale;
      u.attDist.value = I.attenuationDistance;
      u.attColor.value.set(I.attenuationColor);
      u.baseRough.value = I.baseRoughness;
      u.frostScale.value = I.frost.scale;
      u.frostThreshold.value = I.frost.threshold;
      u.frostSoftness.value = I.frost.softness;
      u.frostRough.value = I.frost.roughness;
      u.frostDiffuse.value = I.frost.diffuse;
      u.crystalBump.value = I.frost.crystalBump;
      u.crystalScale.value = I.frost.crystalScale;
      const C = I.cracks;
      u.crackLarge.value = C.largeScale;
      u.crackWarp.value = C.warp;
      u.crackCoverage.value = C.coverage;
      u.regionScale.value = C.regionScale;
      u.regionCoverage.value = C.regionCoverage;
      u.veinScale.value = C.veinScale;
      u.veinContrast.value = C.veinContrast;
      u.crackFine.value = C.fineScale;
      u.crackFineAmount.value = C.fineAmount;
      u.fineCoverage.value = C.fineCoverage;
      u.fineNearLarge.value = C.fineNearLarge;
      u.crackWidth.value = C.width;
      u.crackBright.value = C.brightness;
      u.crackDark.value = C.darkness;
      u.crackRefr.value = C.refraction;
      u.surfaceCrack.value = C.surfaceStrength;
      u.crackSteps.value = C.steps;
      u.adaptiveSteps.value = D.performance.adaptiveSteps ? 1 : 0;
      u.smudgeAmount.value = I.smudges.amount;
      u.smudgeCoverage.value = I.smudges.coverage;
      u.smudgeMaskScale.value = I.smudges.maskScale;
      u.smudgeAniso.value = I.smudges.anisotropy;
      u.smudgeRough.value = I.smudges.roughness;
      u.smudgeWhite.value = I.smudges.whiteness;
      u.smudgeScale.value = I.smudges.scale;
      u.microBump.value = I.bumps.microBump;
      u.microScale.value = I.bumps.microScale;
      u.microCoverage.value = I.bumps.microCoverage;
      u.rippleBump.value = I.bumps.rippleBump;
      u.rippleScale.value = I.bumps.rippleScale;
      u.bumpMaskScale.value = I.bumps.maskScale;
      u.clearcoat.value = I.clearcoat;
      u.clearcoatRough.value = I.clearcoatRoughness;
      u.specularIntensity.value = I.specularIntensity;
      u.interiorScatter.value = I.interiorScatter;
      u.deformAmp.value = S.deformAmplitude;
      u.deformFreq.value = S.deformFrequency;
      u.edgeWidth.value = E.edgeWidth;
      u.cutThreshold.value = E.cutThreshold;
      u.cutSoft.value = E.cutSoftness;
      u.edgeInset.value = E.edgeInset;
      u.interiorSteps.value = E.interiorSteps;
      u.interiorFrost.value = E.interiorFrost;
      u.crumbleGlow.value = I.crumbleGlow;
      u.edgeWhite.value = I.edgeWhiteness;
      u.edgeBump.value = E.edgeBump;
      u.edgeBumpScale.value = E.edgeBumpScale;
      u.refrostStrength.value = H.refrostStrength;
      u.powderTone.value.set(D.powder.baseTone);
      u.keyIntensity.value = D.lighting.key.intensity;
      u.keyColor.value.set(D.lighting.key.color);
    }
    // key direction in object space
    lightDir.copy(keyLight.position).sub(keyLight.target.position).normalize();
    objectGroup.getWorldQuaternion(objectRotation).invert();
    u.lightDir.value.copy(lightDir.applyQuaternion(objectRotation));
    u.model.value.copy(objectGroup.matrixWorld);
    u.modelInv.value.copy(objectGroup.matrixWorld).invert();
    // deterministic per-frame blue-noise offset (golden-ratio sequence) so TRAA converges instead of blinking
    const frameIndex = frameIndexOverride >= 0 ? frameIndexOverride : ++frameCounter;
    u.jitter.value.set((frameIndex * 0.7548776662) % 1, (frameIndex * 0.5698402909) % 1);
  }

  return { material, uniforms: u, features: f, update };
}
