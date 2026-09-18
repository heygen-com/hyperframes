/** Spatial return groups, evaluated once per retarget, never in the flight integrator. */
import { tsl } from "../tsl/t";
import { hash31, voronoiCell, gnoise } from "../tsl/noise";
import preset from "../../presets/approved-material.json";
const { max, float, length, sqrt, log, select, smoothstep, vec3, dot, abs, cos, sin, clamp, mix } =
  tsl;
export const RETURN_GROUP_DEFAULTS = {
  returnGroupStagger: preset.returnGroupStagger,
  returnGroupScale: preset.returnGroupScale,
  returnGroupSeed: preset.returnGroupSeed,
  returnNoiseAmount: 2,
  assemblyFrontDuration: 3.2,
  assemblyOriginX: -0.65,
  assemblyOriginY: 0.55,
  assemblyAngle: -35,
  assemblySpread: 0.65,
  assemblyFrontNoise: 0.35,
  assemblySpeedVariation: 0.65,
  assemblyBend: 1.2,
  assemblySwirl: 1.1,
  assemblyLandingVariation: 0.8,
};
export function returnGroupPhase(p: any, scale: any, seed: any, noiseAmount: any = float(0)) {
  const cell = voronoiCell(p.div(max(scale, 0.1)), seed);
  const q = p.div(max(scale, 0.1)).add(vec3(seed.mul(0.173), seed.mul(0.317), seed.mul(0.571)));
  const noise = smoothstep(0.18, 0.82, gnoise(q).mul(0.5).add(0.5));
  return select(noiseAmount.greaterThan(0.5), noise, hash31(cell.xyz.add(11.7)));
}
/** Conservative travel + settling allowance, used only to limit *additional* delay.
 * Flight parameters and existing wave timing are never changed by the group control. */
export function returnReserve(distance: any, speed: any, u: any) {
  const frequency = sqrt(max(u.springK, 0.5));
  const envelope = distance.add(speed.div(frequency)).add(0.03);
  return max(
    float(2.8),
    u.springRamp
      .add(distance.div(max(u.returnMaxSpeed, 1)))
      .add(
        log(max(envelope.div(max(u.landRadius, 0.001)), 1)).div(
          max(frequency.mul(u.springDamp), 0.5),
        ),
      )
      .add(0.35),
  );
}

/** A travelling seam spreads sideways, like the breakup brush. Object-space field,
 * evaluated only at retarget; packed into the existing threshold slot. */
export function assemblyFrontPhase(p: any, u: any) {
  const q = p.div(max(u.bound, 0.001)).sub(vec3(u.frontX, u.frontY, 0));
  const angle = u.frontAngle.mul(Math.PI / 180);
  const along = dot(q.xy, vec3(cos(angle), sin(angle), 0).xy);
  const across = abs(dot(q.xy, vec3(sin(angle).negate(), cos(angle), 0).xy));
  // Behind the start grows too, at a slower rate; no disconnected glyph is excluded.
  const travel = max(along, 0).add(max(along.negate(), 0).mul(1.4)).div(1.5);
  const spread = across.div(1.5);
  const noise = gnoise(p.div(max(u.groupScale, 0.1)).add(u.groupSeed.mul(0.173)))
    .mul(0.5)
    .add(0.5);
  return clamp(mix(travel, spread, u.frontSpread).add(noise.mul(u.frontNoise).mul(0.35)), 0, 1);
}
