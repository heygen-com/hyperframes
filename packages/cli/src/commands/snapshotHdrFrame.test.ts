import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractVideoFrameToBuffer } from "./snapshot.js";

const hasZscale =
  spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout?.includes(
    "zscale",
  ) === true;

function hlgClip(dir: string): string {
  const clip = join(dir, "clip.mp4");
  const made = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", "smptehdbars=size=320x180:rate=10:duration=1"]
      .concat(["-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "12"])
      .concat(["-color_primaries", "bt2020", "-color_trc", "arib-std-b67"])
      .concat(["-colorspace", "bt2020nc", "-color_range", "tv", clip]),
  );
  expect(made.status).toBe(0);
  return clip;
}

describe.runIf(hasZscale)("a snapshot still of HDR footage", () => {
  it("is tone-mapped to SDR like the export, not left tagged HLG for the browser to map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-hdr-"));
    const buffer = await extractVideoFrameToBuffer(hlgClip(dir), 0.5);
    expect(buffer).not.toBeNull();
    const png = join(dir, "still.png");
    writeFileSync(png, buffer!);
    const tags = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=color_transfer", "-of", "csv=p=0", "--", png],
      { encoding: "utf8" },
    ).stdout.trim();
    expect(tags).not.toBe("arib-std-b67");
    const rgb = spawnSync(
      "ffmpeg",
      ["-v", "error", "-i", png, "-vf", "crop=1:1:25:75,format=rgb24"].concat([
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-",
      ]),
    ).stdout;
    // The 40% grey bar: the export's tone map gives about 102 (an untouched HLG decode gives the same
    // number but stays tagged HLG, which the browser then maps darker).
    expect(Math.abs(rgb[0]! - 102)).toBeLessThanOrEqual(8);
  }, 60_000);
});
