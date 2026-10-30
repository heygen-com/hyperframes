#!/usr/bin/env bun
// Stages /var/task for the arm64 video function image: the handler ZIP with its x86 ffmpeg and Chrome
// swapped for the native ffmpeg tree (image/Dockerfile's artifact) and Sparticuz's arm64 Chrome pack.
//   bun packages/aws-lambda/scripts/stage-arm64-image.ts --ffmpeg=<hf-media tarball> [--zip=..] [--out=..]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The npm package ships x64 Chrome only. Bumping @sparticuz/chromium fails here until its arm64 pack is pinned.
export const CHROMIUM_ARM64_PACK_SHA256: Record<string, string> = {
  "148.0.0": "c18a5241b0a460cba233fff3abccd6678ebdcf855b8548bb7c58240a477f5f0e",
};

export interface StageOptions {
  handlerZip: string;
  ffmpegTarball: string;
  outDir: string;
  fetchPack?: (url: string) => Promise<Uint8Array>;
  packPins?: Record<string, string>;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[stage-arm64-image] GET ${url} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function run(cmd: string, args: string[], input?: Uint8Array): void {
  const result = spawnSync(cmd, args, {
    stdio: [input ? "pipe" : "inherit", "inherit", "inherit"],
    input,
  });
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

async function stageChromiumArm64(chromiumDir: string, opts: StageOptions) {
  const { version } = JSON.parse(readFileSync(join(chromiumDir, "package.json"), "utf-8")) as {
    version: string;
  };
  // The URL is built from the pin table's own key, never from the version read off disk.
  const [pinnedVersion, pinned] =
    Object.entries(opts.packPins ?? CHROMIUM_ARM64_PACK_SHA256).find(([v]) => v === version) ?? [];
  if (!pinnedVersion || !pinned) {
    throw new Error(
      `[stage-arm64-image] no arm64 Chrome pack pinned for @sparticuz/chromium ${version}; ` +
        "add its sha256 to CHROMIUM_ARM64_PACK_SHA256",
    );
  }
  const url = `https://github.com/Sparticuz/chromium/releases/download/v${pinnedVersion}/chromium-v${pinnedVersion}-pack.arm64.tar`;
  const pack = await (opts.fetchPack ?? fetchBytes)(url);
  const actual = createHash("sha256").update(pack).digest("hex");
  if (actual !== pinned) {
    throw new Error(`[stage-arm64-image] ${url} has sha256 ${actual}, pinned ${pinned}`);
  }
  // Only bytes that matched the pin reach tar, over stdin; the pack is never written to a file.
  run("tar", ["-xf", "-", "-C", join(chromiumDir, "bin")], pack);
}

export async function stageArm64Image(opts: StageOptions): Promise<string> {
  const task = join(opts.outDir, "task");
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(task, { recursive: true });
  run("unzip", ["-q", opts.handlerZip, "-d", task]);
  if (existsSync(join(task, "bin", "chrome-headless-shell"))) {
    throw new Error("[stage-arm64-image] the arm64 image bundles sparticuz Chrome only");
  }
  rmSync(join(task, "bin", "ffmpeg"));
  rmSync(join(task, "bin", "ffprobe"));
  run("tar", ["-xzf", opts.ffmpegTarball, "-C", task, "--strip-components=1"]);
  for (const bin of ["ffmpeg", "ffprobe"]) assertArm64Elf(join(task, "bin", bin));
  await stageChromiumArm64(join(task, "node_modules", "@sparticuz", "chromium"), opts);
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
