import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CHROMIUM_ARM64_PACK_SHA256, stageArm64Image } from "./stage-arm64-image.js";

const X86_64 = 0x3e;
const AARCH64 = 0xb7;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function elf(machine: number): Buffer {
  const head = Buffer.alloc(64);
  head.writeUInt32BE(0x7f454c46, 0);
  head[4] = 2;
  head.writeUInt16LE(machine, 18);
  return head;
}

function tree(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "stage-arm64-"));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

function pack(cmd: string, args: string[], cwd: string): void {
  expect(spawnSync(cmd, args, { cwd }).status).toBe(0);
}

function fixture(opts: { ffmpegMachine?: number; zipExtra?: Record<string, string> } = {}) {
  const zipDir = tree({
    "handler.mjs": "export const handler = () => {};",
    "bin/ffmpeg": elf(X86_64),
    "bin/ffprobe": elf(X86_64),
    "node_modules/@sparticuz/chromium/package.json": JSON.stringify({ version: "148.0.0" }),
    "node_modules/@sparticuz/chromium/bin/chromium.br": "x64 chrome",
    ...opts.zipExtra,
  });
  pack("zip", ["-qr", "handler.zip", "."], zipDir);
  const machine = opts.ffmpegMachine ?? AARCH64;
  const mediaDir = tree({
    "hf-media/bin/ffmpeg": elf(machine),
    "hf-media/bin/ffprobe": elf(machine),
    "hf-media/lib/libgnutls.so.30": "gnutls",
  });
  pack("tar", ["-czf", "hf-media.tar.gz", "hf-media"], mediaDir);
  const packDir = tree({ "chromium.br": "arm64 chrome", "al2023.tar.br": "arm64 libs" });
  pack("tar", ["-cf", "pack.tar", "chromium.br", "al2023.tar.br"], packDir);
  const packBytes = readFileSync(join(packDir, "pack.tar"));
  return {
    handlerZip: join(zipDir, "handler.zip"),
    ffmpegTarball: join(mediaDir, "hf-media.tar.gz"),
    outDir: join(tree({}), "out"),
    fetchPack: async () => packBytes,
    packPins: { "148.0.0": createHash("sha256").update(packBytes).digest("hex") },
  };
}

describe("stageArm64Image", () => {
  it("swaps the handler ZIP's x86 ffmpeg and Chrome for the arm64 ones", async () => {
    const task = await stageArm64Image(fixture());
    expect(readFileSync(join(task, "bin/ffmpeg")).readUInt16LE(18)).toBe(AARCH64);
    expect(readFileSync(join(task, "bin/ffprobe")).readUInt16LE(18)).toBe(AARCH64);
    expect(readFileSync(join(task, "lib/libgnutls.so.30"), "utf-8")).toBe("gnutls");
    const chromeBin = join(task, "node_modules/@sparticuz/chromium/bin");
    expect(readFileSync(join(chromeBin, "chromium.br"), "utf-8")).toBe("arm64 chrome");
    expect(readFileSync(join(chromeBin, "al2023.tar.br"), "utf-8")).toBe("arm64 libs");
    expect(readFileSync(join(task, "handler.mjs"), "utf-8")).toContain("handler");
  });

  it("refuses an ffmpeg tarball that is not arm64", async () => {
    await expect(stageArm64Image(fixture({ ffmpegMachine: X86_64 }))).rejects.toThrow(
      "is not a 64-bit arm64 ELF binary",
    );
  });

  it("refuses a Chrome pack whose sha256 is not the pinned one", async () => {
    const opts = { ...fixture(), packPins: CHROMIUM_ARM64_PACK_SHA256 };
    await expect(stageArm64Image(opts)).rejects.toThrow("pinned c18a5241");
  });

  it("refuses a @sparticuz/chromium version with no pinned arm64 pack", async () => {
    await expect(stageArm64Image({ ...fixture(), packPins: {} })).rejects.toThrow(
      "no arm64 Chrome pack pinned for @sparticuz/chromium 148.0.0",
    );
  });

  it("refuses a handler ZIP built with chrome-headless-shell", async () => {
    const opts = fixture({ zipExtra: { "bin/chrome-headless-shell": "x86 chrome" } });
    await expect(stageArm64Image(opts)).rejects.toThrow("sparticuz Chrome only");
  });
});
