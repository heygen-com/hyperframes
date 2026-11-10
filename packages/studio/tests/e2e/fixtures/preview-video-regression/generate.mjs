import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL(".", import.meta.url)));
const assets = join(root, "assets");
const width = 640;
const height = 360;
await mkdir(assets, { recursive: true });
await copyFile(
  createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"),
  join(assets, "gsap.min.js"),
);

function codecOptions(alpha) {
  return alpha
    ? [
        "-c:v",
        "libvpx-vp9",
        "-lossless",
        "1",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
      ]
    : [
        "-c:v",
        "libx264",
        "-crf",
        "10",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
      ];
}
function opaqueBase(base, color) {
  for (let i = 0; i < base.length; i += 4) {
    base[i] = color[0];
    base[i + 1] = color[1];
    base[i + 2] = color[2];
    base[i + 3] = 255;
  }
}
function alphaBase(base) {
  for (let y = 100; y < 220; y++)
    for (let x = 80; x < 200; x++) {
      const i = (y * width + x) * 4;
      base[i + 1] = 208;
      base[i + 2] = 96;
      base[i + 3] = 255;
    }
}
function baseFrame(color) {
  const base = Buffer.alloc(width * height * 4);
  if (color) opaqueBase(base, color);
  else alphaBase(base);
  return base;
}
function checker(pixels, frame) {
  for (let y = 20; y < 52; y++)
    for (let x = 300; x < 428; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = (x + frame) % 2 ? 255 : 0;
      pixels[i + 3] = 255;
    }
}
function timeMarker(pixels, frame) {
  for (let y = 300; y < 315; y++) {
    const left = 20 + Math.floor(frame / 30) * 50;
    for (let x = left; x < left + 20; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    }
  }
}
function texture(pixels, frame) {
  // A deterministic texture keeps native range reads from buffering the entire fixture at once.
  let seed = frame + 1;
  for (let y = 0; y < 64; y++)
    for (let x = 544; x < 640; x++) {
      const i = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels[i + channel] = seed >>> 24;
      }
    }
}
function framePixels(base, alpha, frame) {
  const pixels = Buffer.from(base);
  if (alpha) checker(pixels, frame);
  else {
    timeMarker(pixels, frame);
    texture(pixels, frame);
  }
  return pixels;
}
async function writeFrames(stream, base, alpha, frames) {
  for (let frame = 0; frame < frames; frame++) {
    if (!stream.write(framePixels(base, alpha, frame))) await once(stream, "drain");
  }
  stream.end();
}
async function encode(name, frames, color) {
  const alpha = color === null;
  const child = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      `${width}x${height}`,
      "-framerate",
      "30",
      "-i",
      "pipe:0",
      ...codecOptions(alpha),
      "-g",
      "30",
      "-an",
      join(assets, name),
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let errors = "";
  child.stderr.on("data", (data) => {
    errors += data;
  });
  const finished = new Promise((resolveDone, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolveDone() : reject(new Error(`ffmpeg ${name}: ${errors}`)),
    );
  });
  try {
    await writeFrames(child.stdin, baseFrame(color), alpha, frames);
    await finished;
  } catch (error) {
    child.kill("SIGTERM");
    await finished.catch(() => {});
    throw error;
  }
}

await encode("background-a.mp4", 180, [204, 48, 48]);
await encode("background-b.mp4", 180, [40, 102, 221]);
await encode("foreground.webm", 360, null);
console.log(JSON.stringify({ assets, width, height, fps: 30, duration: 12, synthetic: true }));
