/**
 * `watchEncoder` against real processes: the layered stage's encoder spawned
 * through `HYPERFRAMES_FFMPEG_PATH` naming ffmpeg itself, or a symlink, a
 * renamed copy or a script that execs it in place (all paced), or a wrapper
 * that starts the real encoder as its child, in its own session, or outside
 * its process tree after a delay (all declined: pacing would read the
 * wrapper's idle threads).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFfmpegBinary, spawnStreamingEncoder } from "@hyperframes/engine";
import { ENCODER_IDLE, EncoderPacingError, watchEncoder } from "./encoderPacing.js";

const FFMPEG = getFfmpegBinary();
const HAS_X265 =
  spawnSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf-8" }).stdout?.includes(
    "libx265",
  ) ?? false;
const SIZE = 64;
const FRAME = Buffer.alloc(SIZE * SIZE * 6, 0x40);

/**
 * A wrapper script named ffmpeg (its process runs `sh`, an ELF that is not
 * ffmpeg). It hands `-buildconf` to the real ffmpeg, so it reports libx265,
 * and starts the real ffmpeg: `child` as its child in a new session;
 * `daemon` in a new session outside its process tree (a subshell
 * backgrounds it and exits, so it is reparented); `delayed` outside its
 * process tree only a second into the encode. It stays, with no process of
 * its own, until that ffmpeg exits: it reads a FIFO only ffmpeg holds open.
 */
function wrapperScript(mode: "child" | "daemon" | "delayed"): string {
  const real = JSON.stringify(FFMPEG);
  const start =
    mode === "child"
      ? `setsid ${real} "$@"`
      : // An async command's stdin is /dev/null: it reads the encode's frames from fd 3 instead.
        `exec 3<&0 4>&1
${mode === "delayed" ? 'case "$*" in *rawvideo*) sleep 1 ;; esac' : ""}
fifo="$0.$$.fifo"
mkfifo "$fifo"
( ${mode === "daemon" ? "setsid " : ""}${real} "$@" <&3 >&4 3<&- 4>&- 5>"$fifo" & )
exec 6<"$fifo" 3<&- 4>&-
rm -f "$fifo"
read -r _ <&6 || exit 0`;
  return `#!/bin/sh
case "$*" in *-buildconf*) exec ${real} "$@" ;; esac
${start}
`;
}

const HAS_CC = spawnSync("cc", ["--version"]).status === 0;

/**
 * A C wrapper named ffmpeg in its own folder under `dir`: `delayed` sleeps
 * a second into the encode, then forks twice so the real ffmpeg is
 * reparented; `daemon` does the same in a new session at once; `child`
 * runs it as its child in a new session. The first two stay until ffmpeg
 * closes a pipe only it holds, the last waits for it.
 */
function compileWrapper(dir: string, mode: "child" | "daemon" | "delayed"): string {
  const real = JSON.stringify(FFMPEG);
  const source = `#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
  argv[0] = ${real};
  for (int i = 1; i < argc; i++) if (!strcmp(argv[i], "-buildconf")) { execv(argv[0], argv); return 127; }
  if (${mode === "child" ? 1 : 0}) {
    pid_t child = fork();
    if (child == 0) { setsid(); execv(argv[0], argv); _exit(127); }
    int status; waitpid(child, &status, 0); return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
  }
  if (${mode === "delayed" ? 1 : 0}) for (int i = 1; i < argc; i++) if (!strcmp(argv[i], "rawvideo")) sleep(1);
  int alive[2];
  if (pipe(alive)) return 1;
  pid_t middle = fork();
  if (middle == 0) {
    if (${mode === "daemon" ? 1 : 0}) setsid();
    if (fork() == 0) { close(alive[0]); execv(argv[0], argv); _exit(127); }
    _exit(0);
  }
  close(alive[1]); close(0); close(1);
  int status; waitpid(middle, &status, 0);
  char byte; while (read(alive[0], &byte, 1) > 0) {}
  return 0;
}
`;
  const folder = join(dir, `binary-${mode}`);
  mkdirSync(folder);
  const sourcePath = join(folder, "wrapper.c");
  writeFileSync(sourcePath, source);
  const binary = join(folder, "ffmpeg");
  const built = spawnSync("cc", ["-O1", "-o", binary, sourcePath], { encoding: "utf-8" });
  if (built.status !== 0) throw new Error(`cc failed: ${built.stderr}`);
  return binary;
}

describe.skipIf(!HAS_X265 || process.platform !== "linux")("watchEncoder on real processes", () => {
  const saved = process.env.HYPERFRAMES_FFMPEG_PATH;
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hdr-passthrough-pacing-"));
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = saved;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function executable(name: string, content: string): string {
    const path = join(dir, name);
    writeFileSync(path, content);
    chmodSync(path, 0o755);
    return path;
  }

  /** Encodes three frames through `ffmpegPath` paced by `watchEncoder`: "paced", or why it declined. */
  async function pace(ffmpegPath: string, codec: "h264" | "h265" = "h265"): Promise<string> {
    process.env.HYPERFRAMES_FFMPEG_PATH = ffmpegPath;
    const encoder = await spawnStreamingEncoder(join(dir, `out-${Math.random()}.mp4`), {
      fps: { num: 30, den: 1 },
      width: SIZE,
      height: SIZE,
      codec,
      preset: "ultrafast",
      quality: 28,
      pixelFormat: codec === "h265" ? "yuv420p10le" : "yuv420p",
      rawInputFormat: "rgb48le",
    });
    try {
      const pacer = await watchEncoder(encoder.pid);
      for (let frame = 0; frame < 3; frame++) {
        pacer.check();
        expect(await encoder.writeFrame(FRAME)).toBe(true);
        await pacer.waitUntilIdle(ENCODER_IDLE);
      }
      return "paced";
    } catch (error) {
      if (error instanceof EncoderPacingError) return error.message;
      throw error;
    } finally {
      await encoder.close().catch(() => undefined);
      process.env.HYPERFRAMES_FFMPEG_PATH = saved ?? "";
      if (saved === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    }
  }

  it("paces ffmpeg itself, a symlink to it, a renamed copy and a script that execs it", async () => {
    const link = join(dir, "ffmpeg-link");
    symlinkSync(FFMPEG, link);
    const copy = join(dir, "encoder-copy");
    copyFileSync(FFMPEG, copy);
    chmodSync(copy, 0o755);
    const execs = executable("exec-ffmpeg", `#!/bin/sh\nexec "${FFMPEG}" "$@"\n`);
    for (const path of [FFMPEG, link, copy, execs]) expect(await pace(path)).toBe("paced");
  }, 120_000);

  it("declines a script that runs ffmpeg as its child", async () => {
    const script = executable("ffmpeg", `#!/bin/sh\n"${FFMPEG}" "$@"\n`);
    expect(await pace(script)).toMatch(
      /started \d+ process\(es\)|does not report --enable-libx265/,
    );
  }, 60_000);

  /** Checks the wrapper at `path` really encodes, so a decline is not for want of an encode. */
  function expectEncodes(path: string, name: string) {
    const out = join(dir, `direct-${name}.mp4`);
    const direct = spawnSync(
      path,
      ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb48le"].concat([
        "-s",
        `${SIZE}x${SIZE}`,
        "-r",
        "30",
        "-i",
        "-",
        "-c:v",
        "libx265",
        "-y",
        out,
      ]),
      { input: Buffer.concat([FRAME, FRAME]), timeout: 30_000 },
    );
    expect(direct.status).toBe(0);
    expect(statSync(out).size).toBeGreaterThan(0);
  }

  it.each([
    ["as its child, in its own session", "child" as const],
    ["outside its process tree, in a new session", "daemon" as const],
    ["outside its process tree, a second into the encode", "delayed" as const],
  ])(
    "declines a wrapper script that runs ffmpeg %s",
    async (_name, mode) => {
      mkdirSync(join(dir, `script-${mode}`));
      const wrapper = executable(join(`script-${mode}`, "ffmpeg"), wrapperScript(mode));
      // Its process runs the shell, which is no ffmpeg (or, for `child`, has a child first).
      expect(await pace(wrapper)).toMatch(
        /started 1 process\(es\)|which does not report --enable-libx265/,
      );
      expectEncodes(wrapper, `script-${mode}`);
    },
    60_000,
  );

  // Binaries named ffmpeg that run the real one outside their own process tree, as a delayed
  // double fork or a daemon: with no child left to find, only what the process runs gives them
  // away. They hand -buildconf to the real ffmpeg, so that reports libx265 too.
  describe.skipIf(!HAS_CC)("compiled wrappers", () => {
    it.each([
      ["a delayed double fork", "delayed" as const, /holds no libx265 code/],
      ["a daemon (setsid, then fork)", "daemon" as const, /holds no libx265 code/],
      ["a child in its own session", "child" as const, /started 1 process\(es\)/],
    ])(
      "declines a binary that runs ffmpeg as %s",
      async (_name, mode, reason) => {
        const wrapper = compileWrapper(dir, mode);
        expect(await pace(wrapper)).toMatch(reason);
        expectEncodes(wrapper, `binary-${mode}`);
      },
      60_000,
    );
  });

  it("declines an ffmpeg that encodes with another encoder than libx265", async () => {
    expect(await pace(FFMPEG, "h264")).toContain("no thread named for libx265");
  }, 60_000);
});
