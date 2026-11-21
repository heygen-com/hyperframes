#!/usr/bin/env bun
// Stages /var/task for the arm64 video function image: the handler ZIP with its x86 ffmpeg swapped for the
// native ffmpeg tree (image/Dockerfile's artifact) and its x86 sparticuz Chrome dropped, keeping sparticuz's fonts.
// The image installs its own chrome-headless-shell (image/Dockerfile's video target).
//   bun packages/aws-lambda/scripts/stage-arm64-image.ts --ffmpeg=<hf-media tarball> [--zip=..] [--out=..]
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { BUNDLED_SHELL_DIR } from "../src/chromium.js";

export interface StageOptions {
  handlerZip: string;
  ffmpegTarball: string;
  outDir: string;
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`[stage-arm64-image] ${cmd} ${args.join(" ")} exited ${result.status}`);
  }
}

export function assertArm64Elf(path: string): void {
  const head = Buffer.alloc(20);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  const elf64 = head.readUInt32BE(0) === 0x7f454c46 && head[4] === 2;
  if (!elf64 || head.readUInt16LE(18) !== 0xb7) {
    throw new Error(`[stage-arm64-image] ${path} is not a 64-bit arm64 ELF binary`);
  }
}

export async function stageArm64Image(opts: StageOptions): Promise<string> {
  const task = join(opts.outDir, "task");
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(task, { recursive: true });
  run("unzip", ["-q", opts.handlerZip, "-d", task]);
  if (existsSync(join(task, BUNDLED_SHELL_DIR))) {
    throw new Error(
      "[stage-arm64-image] the arm64 image is built from the sparticuz handler ZIP; it installs its own chrome-headless-shell",
    );
  }
  rmSync(join(task, "bin", "ffmpeg"));
  rmSync(join(task, "bin", "ffprobe"));
  run("tar", ["-xzf", opts.ffmpegTarball, "-C", task, "--strip-components=1"]);
  for (const bin of ["ffmpeg", "ffprobe"]) assertArm64Elf(join(task, "bin", bin));
  const sparticuzBin = join(task, "node_modules", "@sparticuz", "chromium", "bin");
  // Its fonts and fonts.conf, unpacked where @sparticuz/chromium unpacks them under /tmp, so text falls back alike.
  const fontsTar = join(opts.outDir, "fonts.tar");
  writeFileSync(fontsTar, brotliDecompressSync(readFileSync(join(sparticuzBin, "fonts.tar.br"))));
  mkdirSync(join(task, "fonts"));
  run("tar", ["-xf", fontsTar, "-C", join(task, "fonts")]);
  rmSync(fontsTar);
  // x86 Chrome cannot run here; the image's HYPERFRAMES_LAMBDA_CHROME_SOURCE never loads it.
  rmSync(sparticuzBin, { recursive: true });
  return task;
}

if (import.meta.main) {
  const distDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
  const flag = (name: string) =>
    process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const ffmpegTarball = flag("ffmpeg");
  if (!ffmpegTarball)
    throw new Error("[stage-arm64-image] --ffmpeg=<hf-media tarball> is required");
  const task = await stageArm64Image({
    handlerZip: flag("zip") ?? join(distDir, "handler.zip"),
    ffmpegTarball,
    outDir: flag("out") ?? join(distDir, "arm64-image"),
  });
  console.log(`[stage-arm64-image] staged ${task}`);
}
