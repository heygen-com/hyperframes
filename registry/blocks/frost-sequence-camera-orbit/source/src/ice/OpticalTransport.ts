// Single-boundary entry/exit transport with a bounded SDF exit trace. Reflection
// samples HDR studio cards; transmission projects through the background plane.
// This is a real-time optical approximation, not a multi-bounce path tracer.
import { iceEnvironment } from "./EnvironmentSampling";
import { tsl } from "../tsl/t";
import { backdropColorAt } from "../scene/Backdrop";
const {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  int,
  Loop,
  If,
  Break,
  normalize,
  length,
  max,
  min,
  abs,
  dot,
  pow,
  exp,
  log,
  mix,
  clamp,
  refract,
  reflect,
  select,
  mat3,
  texture,
  equirectUV,
  cameraViewMatrix,
  cameraProjectionMatrix,
  cross,
} = tsl;
type N = any;
export function opticalTransport(o: any) {
  const { shape, erosion, p, ray, normal, environment, backdrop, u, f, roughness } = o;
  const B = shape.bound,
    epsilon = Math.max(0.001, B / 1500);
  const worldDir = (d: N) => normalize(mat3(u.model).mul(d));
  const env = (direction: N, rough: N) =>
    iceEnvironment(environment, u.envStrength, direction, rough);
  const gradient = (q: N) => {
    const e = shape.voxelSize ? shape.voxelSize.mul(0.75) : float(B / 240);
    const g = vec3(
      shape.sdfNode(q.add(vec3(e, 0, 0))).sub(shape.sdfNode(q.sub(vec3(e, 0, 0)))),
      shape.sdfNode(q.add(vec3(0, e, 0))).sub(shape.sdfNode(q.sub(vec3(0, e, 0)))),
      shape.sdfNode(q.add(vec3(0, 0, e))).sub(shape.sdfNode(q.sub(vec3(0, 0, e)))),
    );
    return g.div(max(length(g), 1e-5));
  };
  const ior = max(u.ior, 1.001);
  const n = select(dot(normal, ray).greaterThan(0), normal.negate(), normal);
  const inside = normalize(refract(ray, n, float(1).div(ior)));
  const exit = Fn(() => {
    const distance = float(epsilon * 2).toVar();
    const last = float(0).toVar();
    Loop(64, () => {
      const q = p.add(inside.mul(distance));
      const sdf = shape.sdfNode(q);
      const er = erosion.sample(q).r;
      If(
        distance
          .greaterThan(epsilon * 4)
          .and(sdf.greaterThan(0).or(er.greaterThan(u.cutThreshold))),
        () => {
          Break();
        },
      );
      last.assign(distance);
      distance.addAssign(clamp(abs(sdf).mul(0.7), epsilon, B / 12));
      If(distance.greaterThan(B * 2), () => {
        Break();
      });
    });
    // Refine the boundary so thickness does not jump in visible steps.
    Loop(5, () => {
      const mid = last.add(distance).mul(0.5);
      const q = p.add(inside.mul(mid));
      If(shape.sdfNode(q).lessThan(0).and(erosion.sample(q).r.lessThan(u.cutThreshold)), () => {
        last.assign(mid);
      }).Else(() => {
        distance.assign(mid);
      });
    });
    return vec4(p.add(inside.mul(distance)), distance);
  })();
  const exitNormal = gradient(exit.xyz);
  const exitN = select(dot(exitNormal, inside).lessThan(0), exitNormal.negate(), exitNormal);
  const outward = refract(inside, exitN.negate(), ior);
  const tir = length(outward).lessThan(0.0001);
  const outgoing = select(tir, reflect(inside, exitN), outward);
  const exitWorld = u.model.mul(vec4(exit.xyz, 1)).xyz;
  const transmittedPlate = (direction: N) => {
    const dirW = worldDir(direction);
    const posV = cameraViewMatrix.mul(vec4(exitWorld, 1)).xyz;
    const dirV = mat3(cameraViewMatrix).mul(dirW);
    const t = float(-35).sub(posV.z).div(min(dirV.z, -0.001));
    const q = posV.add(dirV.mul(clamp(t, 0, 150)));
    const clip = cameraProjectionMatrix.mul(vec4(q, 1));
    const uv = vec2(
      clip.x.div(max(clip.w, 0.001)).mul(0.5).add(0.5),
      clip.y.div(max(clip.w, 0.001)).mul(-0.5).add(0.5),
    );
    const background = backdropColorAt(backdrop, clamp(uv, 0, 1));
    // Backlighting is an authored studio source behind the translucent volume.
    return background.add(env(dirW, roughness).mul(u.backlight));
  };
  const dispersion = u.dispersion.mul(f.dispersion).mul(0.025);
  const spreadDir = normalize(cross(inside, exitN).add(vec3(0.00001, 0, 0)));
  const transmitted = vec3(
    transmittedPlate(normalize(outgoing.add(spreadDir.mul(dispersion)))).r,
    transmittedPlate(outgoing).g,
    transmittedPlate(normalize(outgoing.sub(spreadDir.mul(dispersion)))).b,
  );
  const f0 = pow(ior.sub(1).div(ior.add(1)), 2);
  const fresnel = f0
    .add(
      float(1)
        .sub(f0)
        .mul(pow(float(1).sub(clamp(dot(n, ray.negate()), 0, 1)), 5)),
    )
    .mul(f.reflections);
  const exitFresnel = select(
    tir,
    float(1),
    f0.add(
      float(1)
        .sub(f0)
        .mul(pow(float(1).sub(abs(dot(exitN, inside))), 5)),
    ),
  );
  const distance = exit.w.mul(u.thicknessScale);
  const attenuation = exp(
    log(max(u.attColor, vec3(0.001)))
      .mul(distance.div(max(u.attDist, 0.01)))
      .mul(f.absorption),
  );
  const reflected = env(worldDir(reflect(ray, n)), roughness);
  const innerReflection = env(worldDir(reflect(inside, exitN)), roughness);
  const through = transmitted
    .mul(float(1).sub(exitFresnel))
    .add(innerReflection.mul(exitFresnel))
    .mul(attenuation);
  return {
    reflected: reflected.mul(fresnel),
    transmitted: through.mul(float(1).sub(fresnel)),
    distance,
  };
}
