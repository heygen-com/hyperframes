import { useEffect, useRef } from "react";

/**
 * The thinking indicator: particles running real orbits of a sphere, each orbit
 * a faint ring of ghost dots with bright particles travelling it, all depth
 * sorted so the near side paints larger and brighter.
 *
 * Thinking is the one state with nothing to show — no file, no diff, no
 * progress — so its indicator carries the whole signal, and a spinner would say
 * "waiting" where the truth is "working". Algorithm after the orbits orb at
 * orbs.jakubantalik.com; it is small enough to own outright rather than depend
 * on, and it paints in the inherited colour so every state can reuse it.
 */

const SPEED = 4.2;
const ORBITS = 5;
const GHOSTS = 16;
const PARTICLES = 2;
/** Small-size preset: fewer dots, each one bigger, or nothing reads at 16px. */
const DOT = 1.8;

function hash(index: number, seed: number): number {
  const n = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** Yaw then pitch; returns screen x/y plus the depth used to sort and shade. */
function project(yaw: number, pitch: number, cx: number, cy: number) {
  const sy = Math.sin(yaw);
  const cw = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  return (x: number, y: number, z: number): [number, number, number] => {
    const px = x * cw + z * sy;
    const pz = -x * sy + z * cw;
    return [cx + px, cy - (y * cp - pz * sp), y * sp + pz * cp];
  };
}

interface Dot {
  x: number;
  y: number;
  z: number;
  r: number;
  a: number;
}

export function paintOrb(ctx: CanvasRenderingContext2D, size: number, time: number): void {
  ctx.clearRect(0, 0, size, size);
  const radius = (size / 2) * 0.82;
  const scale = (size / 300) ** 0.6 * DOT;
  const to = project(time * 0.12, 0.3, size / 2, size / 2);
  const dots: Dot[] = [];

  for (let i = 0; i < ORBITS; i++) {
    const tilt = hash(i, 1.7);
    const drift = hash(i, 8.9);
    const r = radius * (0.45 + 0.52 * tilt);
    // Plane normals spread evenly rather than randomly: at this few orbits,
    // random ones clump into a blob instead of reading as a sphere.
    const lon = hash(i, 3.3) * 2 * Math.PI;
    const lat = Math.acos(2 * ((i + 0.5) / ORBITS) - 1);
    const nx = Math.sin(lat) * Math.cos(lon);
    const ny = Math.cos(lat);
    const nz = Math.sin(lat) * Math.sin(lon);
    // Two perpendicular vectors spanning this orbit's plane.
    const len = Math.hypot(ny, nx) || 1e-6;
    const ex = -ny / len;
    const ey = nx / len;
    const gx = -nz * ey;
    const gy = nz * ex;
    const gz = nx * ey - ny * ex;
    const at = (angle: number): [number, number, number] => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return to((ex * c + gx * s) * r, (ey * c + gy * s) * r, gz * s * r);
    };

    for (let g = 0; g < GHOSTS; g++) {
      const [x, y, z] = at((g / GHOSTS) * 2 * Math.PI);
      const depth = (z / r + 1) / 2;
      dots.push({ x, y, z, r: 1.1 * scale, a: 0.1 + 0.2 * depth });
    }
    const speed = (0.25 + 0.55 * drift) * (drift > 0.5 ? 1 : -1);
    for (let p = 0; p < PARTICLES; p++) {
      const [x, y, z] = at(time * speed + (p / PARTICLES) * 2 * Math.PI + tilt * 6);
      const depth = (z / r + 1) / 2;
      dots.push({ x, y, z, r: (1.2 + 1.6 * depth) * scale, a: 0.45 + 0.55 * depth });
    }
  }

  dots.sort((a, b) => a.z - b.z);
  for (const dot of dots) {
    ctx.globalAlpha = dot.a;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, Math.max(0.3, dot.r), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function ThinkingOrb({ size = 16 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);
    // Paint in the inherited colour as-is: the pill's colour is a color-mix(),
    // which computes to oklab() and would not survive being read into rgba().
    ctx.fillStyle = getComputedStyle(canvas).color;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paintOrb(ctx, size, 0);
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      paintOrb(ctx, size, (now / 1000) * SPEED);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="block shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
