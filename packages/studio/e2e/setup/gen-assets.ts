import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(__dirname, "../fixtures/parity-project/assets");
mkdirSync(assetsDir, { recursive: true });

// Solid blue 400×300 JPEG (~4 KB)
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x3b82f6:s=400x300:d=1",
    "-vframes",
    "1",
    "-q:v",
    "10",
    `${assetsDir}/photo.jpg`,
  ],
  { stdio: "inherit" },
);
console.log("Generated photo.jpg");

// 3-second solid-color MP4 at 600×338, 30 fps — solid color is platform-agnostic
// (testsrc2 caused cross-platform YUV→RGB conversion differences)
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x5e81ac:s=600x338:rate=30:d=3",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-t",
    "3",
    `${assetsDir}/clip.mp4`,
  ],
  { stdio: "inherit" },
);
console.log("Generated clip.mp4");
