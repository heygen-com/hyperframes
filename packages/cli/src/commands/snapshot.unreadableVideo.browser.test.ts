import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { findFFmpeg } from "../browser/ffmpeg.js";
import snapshotCommand from "./snapshot.js";

const root = mkdtempSync(join(tmpdir(), "hf-snapshot-unreadable-video-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

function writeProject(name: string, clipStart: number, clipDuration = 2): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="320" data-height="180" style="position:relative;width:320px;height:180px">
  <video id="v" class="clip" src="clip.mp4" data-start="${clipStart}" data-duration="${clipDuration}" data-track-index="0" muted style="position:absolute;inset:0;width:320px;height:180px"></video>
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = { pause() {}, time() { return 0; }, duration() { return 5; }, seek() {} };
</script></body></html>`,
  );
  writeFileSync(join(dir, "clip.mp4"), "this is not a video");
  return dir;
}

async function resultAt(
  dir: string,
  time: string,
): Promise<{ ok: boolean; error?: { message: string } }> {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await snapshotCommand
      .run?.({
        args: {
          dir,
          at: time,
          end: false,
          json: true,
          output: join(dir, "out"),
          describe: "false",
          "browser-gpu": false,
        },
      } as never)
      .catch(() => undefined);
    return JSON.parse(String(log.mock.calls.at(-1)?.[0]));
  } finally {
    vi.restoreAllMocks();
  }
}

it("fails, naming the folder, when a video on screen cannot be read", async () => {
  const dir = writeProject("unreadable", 1);
  const result = await resultAt(dir, "1.5");

  expect(result.ok).toBe(false);
  expect(result.error?.message).toMatch(/video frame\(s\) could not be read.*black or stale/);
  expect(readdirSync(join(dir, "out")).some((name) => /at-1\.5s\.png$/.test(name))).toBe(true);
}, 120_000);

const ffmpeg = findFFmpeg();
const hasX265 =
  !!ffmpeg &&
  execFileSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf-8" }).includes("libx265");

it.skipIf(!hasX265)(
  "does not fail for a readable clip held past the end of its source",
  async () => {
    const dir = writeProject("held-past-end", 1, 3);
    execFileSync(ffmpeg!, [
      ...["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=1:r=24:s=160x90"],
      ...["-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-y", join(dir, "clip.mp4")],
    ]);
    const result = await resultAt(dir, "3.5");

    expect(result.ok).toBe(true);
  },
  120_000,
);
