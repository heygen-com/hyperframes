// Fullscreen studio backdrop: a single soft radial bloom from the top-centre falling to near-black,
// rendered directly as `scene.backgroundNode` with dithering so it never bands.
import { tsl } from "../tsl/t";
const {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  uniform,
  screenUV,
  screenSize,
  mix,
  pow,
  smoothstep,
  fract,
  sin,
  dot,
  length,
  max,
} = tsl;
import * as THREE from "three/webgpu";
import { hash31 } from "../tsl/noise";

export type BackdropUniforms = {
  uTop: any;
  uMid: any;
  uBottom: any;
  uCenter: any;
  uRadius: any;
  uFalloff: any;
  uNoise: any;
  uTime: any;
};

/** The studio gradient colour at a screen uv (shared by the background and the translucent grains). */
export function backdropColorAt(u: BackdropUniforms, uv: any) {
  const aspect = screenSize.x.div(screenSize.y);
  const d = vec2(uv.x.sub(u.uCenter.x).mul(aspect), uv.y.sub(u.uCenter.y));
  const r = length(d).div(u.uRadius);
  const t = pow(smoothstep(0.0, 1.0, r), u.uFalloff);
  const vert = smoothstep(0.0, 1.0, uv.y.oneMinus().mul(1.15));
  const corner = smoothstep(0.35, 1.3, length(vec2(uv.x.sub(0.5).mul(aspect), uv.y.sub(0.5))));
  const col = mix(u.uTop, u.uMid, t);
  return mix(col, u.uBottom, vert.mul(corner).mul(0.85));
}

export function createBackdrop() {
  const uTop = uniform(new THREE.Color("#2a2a2a"));
  const uMid = uniform(new THREE.Color("#050505"));
  const uBottom = uniform(new THREE.Color("#030303"));
  const uCenter = uniform(new THREE.Vector2(0.5, 1.02));
  const uRadius = uniform(0.55);
  const uFalloff = uniform(1.6);
  const uNoise = uniform(1.0);
  const uTime = uniform(0);

  const uniforms = { uTop, uMid, uBottom, uCenter, uRadius, uFalloff, uNoise, uTime };
  const node = Fn(() => {
    const col = backdropColorAt(uniforms, screenUV).toVar();
    // barely-visible large-scale noise (±1 grey level) plus a hash dither to break banding
    const uv = screenUV;
    const n = hash31(vec3(uv.mul(vec2(37.0, 21.0)), uTime.mul(0.37)));
    const big = sin(dot(uv, vec2(5.3, 7.1)).add(uTime.mul(0.05)))
      .mul(0.5)
      .add(0.5);
    const grey = big
      .sub(0.5)
      .mul(1.0 / 255.0)
      .mul(uNoise)
      .add(
        n
          .sub(0.5)
          .mul(1.0 / 255.0)
          .mul(uNoise),
      );
    return vec4(max(col.add(vec3(grey)), 0.0), 1.0);
  })();

  return { node, uniforms };
}
void fract;
void float;
