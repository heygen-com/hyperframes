import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { join } from "node:path";

/**
 * sha256 of the linux-x64 ffmpeg each `ffmpeg-static` version downloads at install time. The lockfile
 * pins the package, not that download, so a version bump needs its binary's digest added here.
 */
export const PINNED_FFMPEG_STATIC_SHA256: Readonly<Record<string, string>> = {
  "5.3.0": "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
};

function assertPinnedFfmpeg(
  ffmpegModule: string,
  binary: string,
  pinned: Readonly<Record<string, string>>,
): void {
  const { version } = JSON.parse(readFileSync(join(ffmpegModule, "package.json"), "utf-8")) as {
    version: string;
  };
  const expected = pinned[version];
  if (!expected) {
    throw new Error(
      `[build-zip] ffmpeg-static ${version} has no pinned sha256. Add the digest of the linux-x64 ` +
        `binary it downloads to PINNED_FFMPEG_STATIC_SHA256 in scripts/_ffmpeg.ts.`,
    );
  }
  const actual = createHash("sha256").update(readFileSync(binary)).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `[build-zip] ffmpeg-static ${version} binary at ${binary} has sha256 ${actual}, ` +
        `not the pinned ${expected}. Delete node_modules/ffmpeg-static and install it again.`,
    );
  }
}

// ELF header constants used by `assertLinuxX86_64Elf`. Header layout:
// bytes 0..3 magic `0x7F 'E' 'L' 'F'`, byte 4 EI_CLASS (`2` = ELFCLASS64),
// bytes 18..19 e_machine little-endian (`0x3E` = EM_X86_64).
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const ELF_CLASS_64 = 2;
const ELF_MACHINE_X86_64 = 0x3e;
const ELF_HEADER_BYTES = 20;

/**
 * Verify the binary at `path` is a Linux x86-64 ELF executable, the only
 * shape the Lambda runtime can exec. Throws with the canonical workaround
 * (Docker `--platform=linux/amd64` or `npm_config_platform` /
 * `npm_config_arch` overrides) so the build doesn't ship a silently
 * broken zip when a non-Linux host's postinstall fetched the wrong arch.
 */
function assertLinuxX86_64Elf(path: string, label: string): void {
  const head = readFileHead(path, ELF_HEADER_BYTES, label);
  const isElf = head.subarray(0, 4).equals(ELF_MAGIC);
  const isElf64 = head[4] === ELF_CLASS_64;
  const machine = head.readUInt16LE(18);
  if (isElf && isElf64 && machine === ELF_MACHINE_X86_64) return;

  const magicHex = head.subarray(0, 4).toString("hex");
  throw new Error(
    `[build-zip] ${label} at ${path} is not a Linux x86-64 ELF executable ` +
      `(magic=0x${magicHex}, ei_class=${head[4]}, e_machine=0x${machine.toString(16)}). ` +
      `This usually means the deploy host's postinstall fetched a host-platform binary ` +
      `(e.g. macOS arm64 ffmpeg) instead of the linux/x64 binary Lambda needs. ` +
      `Re-run the build inside a linux/amd64 container, or pre-install with ` +
      `\`npm_config_platform=linux npm_config_arch=x64\` so the package fetches the right binary.`,
  );
}

function readFileHead(path: string, byteCount: number, label: string): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(byteCount);
    const bytesRead = readSync(fd, buf, 0, byteCount, 0);
    if (bytesRead < byteCount) {
      throw new Error(
        `[build-zip] ${label} at ${path} is too short — read ${bytesRead} of ${byteCount} bytes.`,
      );
    }
    return buf;
  } finally {
    closeSync(fd);
  }
}

export function stageFfmpeg(
  stagingDir: string,
  ffmpegModule: string,
  ffprobeModule: string,
  pinned: Readonly<Record<string, string>> = PINNED_FFMPEG_STATIC_SHA256,
): void {
  const binDir = join(stagingDir, "bin");
  mkdirSync(binDir, { recursive: true });

  // ffmpeg from `ffmpeg-static`. The package only ships the encoder
  // binary; the audio pad/trim path also needs ffprobe, which comes
  // from `ffprobe-static`.
  //
  // `ffmpeg-static`'s postinstall fetches a binary for the host platform
  // (e.g. arm64 Mach-O on Apple Silicon macOS). Lambda runs Linux x86-64,
  // so a build from a non-Linux host silently produces a zip that boots
  // but fails at first ffmpeg invocation with `cannot execute binary file`.
  // Verify the ELF header up front and bail with a clear message instead.
  const ffmpegBinary = join(ffmpegModule, "ffmpeg");
  if (!existsSync(ffmpegBinary)) {
    throw new Error(
      `[build-zip] ffmpeg-static binary missing at ${ffmpegBinary}. Did postinstall run?`,
    );
  }
  assertLinuxX86_64Elf(ffmpegBinary, "ffmpeg-static binary");
  assertPinnedFfmpeg(ffmpegModule, ffmpegBinary, pinned);
  const ffmpegDest = join(binDir, "ffmpeg");
  cpSync(ffmpegBinary, ffmpegDest);
  chmodSync(ffmpegDest, 0o755);

  // ffprobe lives at `ffprobe-static/bin/<platform>/<arch>/ffprobe`.
  // The producer's `audioPadTrim` spawns `ffprobe` from PATH so we need
  // it alongside ffmpeg under /var/task/bin/.
  const ffprobeCandidates = [
    join(ffprobeModule, "bin", "linux", "x64", "ffprobe"),
    join(ffprobeModule, "bin", "linux", "arm64", "ffprobe"),
  ];
  const ffprobeBinary = ffprobeCandidates.find((p) => existsSync(p));
  if (!ffprobeBinary) {
    throw new Error(
      `[build-zip] ffprobe-static binary not found under ${ffprobeModule}/bin/linux/. Did postinstall run?`,
    );
  }
  const ffprobeDest = join(binDir, "ffprobe");
  cpSync(ffprobeBinary, ffprobeDest);
  chmodSync(ffprobeDest, 0o755);

  console.log(`[build-zip] staged ffmpeg + ffprobe → bin/`);
}
