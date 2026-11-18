import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { BUNDLED_SHELL_DIR } from "../src/chromium.js";
import { stageArm64Image } from "./stage-arm64-image.js";

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

// @sparticuz/chromium's fonts.tar.br: fonts.conf beside a fonts/ folder.
function sparticuzFonts(): Buffer {
  const dir = tree({
    "fonts.conf": "<fontconfig/>",
    "fonts/Open_Sans/OpenSans-Regular.ttf": "ttf",
  });
  pack("tar", ["-cf", "fonts.tar", "fonts.conf", "fonts"], dir);
  return brotliCompressSync(readFileSync(join(dir, "fonts.tar")));
}

function fixture(opts: { ffmpegMachine?: number; zipExtra?: Record<string, string> } = {}) {
  const zipDir = tree({
    "handler.mjs": "export const handler = () => {};",
    "bin/ffmpeg": elf(X86_64),
    "bin/ffprobe": elf(X86_64),
    "node_modules/@sparticuz/chromium/package.json": JSON.stringify({ version: "148.0.0" }),
    "node_modules/@sparticuz/chromium/bin/chromium.br": "x64 chrome",
    "node_modules/@sparticuz/chromium/bin/fonts.tar.br": sparticuzFonts(),
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
  return {
    handlerZip: join(zipDir, "handler.zip"),
    ffmpegTarball: join(mediaDir, "hf-media.tar.gz"),
    outDir: join(tree({}), "out"),
  };
}

describe("stageArm64Image", () => {
  it("swaps the handler ZIP's x86 ffmpeg for the arm64 one and drops its x86 Chrome, not its fonts", async () => {
    const task = await stageArm64Image(fixture());
    expect(readFileSync(join(task, "bin/ffmpeg")).readUInt16LE(18)).toBe(AARCH64);
    expect(readFileSync(join(task, "bin/ffprobe")).readUInt16LE(18)).toBe(AARCH64);
    expect(readFileSync(join(task, "lib/libgnutls.so.30"), "utf-8")).toBe("gnutls");
    // The image installs its own chrome-headless-shell; the ZIP's x86 Chrome cannot run on arm64.
    expect(existsSync(join(task, "node_modules/@sparticuz/chromium/bin"))).toBe(false);
    // Its fonts stay, where image/Dockerfile's FONTCONFIG_PATH points.
    expect(readFileSync(join(task, "fonts/fonts.conf"), "utf-8")).toBe("<fontconfig/>");
    expect(readFileSync(join(task, "fonts/fonts/Open_Sans/OpenSans-Regular.ttf"), "utf-8")).toBe(
      "ttf",
    );
    expect(readFileSync(join(task, "handler.mjs"), "utf-8")).toContain("handler");
  });

  it("refuses an ffmpeg tarball that is not arm64", async () => {
    await expect(stageArm64Image(fixture({ ffmpegMachine: X86_64 }))).rejects.toThrow(
      "is not a 64-bit arm64 ELF binary",
    );
  });

  it("refuses a handler ZIP built with chrome-headless-shell", async () => {
    const opts = fixture({ zipExtra: { [`${BUNDLED_SHELL_DIR}/chrome-headless-shell`]: "x86" } });
    await expect(stageArm64Image(opts)).rejects.toThrow("built from the sparticuz handler ZIP");
  });
});
