import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { buildPublishFileMap } from "../utils/publishProject.js";
import { OFFLOAD_MIN_BYTES, offloadHeavyMedia, type ReencodeProgress } from "./offload.js";

const ffmpeg = findFfBinary("ffmpeg");
const ffprobe = findFfBinary("ffprobe");
const dir = mkdtempSync(join(tmpdir(), "hf-offload-progress-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Two seconds of video with sound, past the offload cutoff, under a name the asset API refuses. */
function clipNeedingReencode(project: string): void {
  const made = join(dir, "made.mov");
  execFileSync(ffmpeg!, [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:d=2"],
    ...["-f", "lavfi", "-i", "sine=f=440:d=2"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", made],
  ]);
  const free = Buffer.alloc(OFFLOAD_MIN_BYTES);
  free.writeUInt32BE(free.length);
  free.write("free", 4);
  writeFileSync(join(project, "take.mkv"), Buffer.concat([readFileSync(made), free]));
}

describe.skipIf(!ffmpeg || !ffprobe)("a re-encode before upload", () => {
  it("reports the output seconds it has made, against the clip's length", async () => {
    const project = mkdtempSync(join(dir, "project-"));
    writeFileSync(
      join(project, "index.html"),
      `<html><body><video src="take.mkv"></video></body></html>`,
    );
    clipNeedingReencode(project);
    const heard: ReencodeProgress[] = [];

    const [item] = await offloadHeavyMedia(project, buildPublishFileMap(project), {
      apiBaseUrl: "https://api.example",
      cachePath: join(project, "cache.json"),
      upload: async () => ({ asset_id: "a", url: "https://assets.example/a.mp4" }),
      onReencodeProgress: (event) => heard.push(event),
    });

    expect(item).toMatchObject({ action: "reencode" });
    expect(heard.length).toBeGreaterThan(0);
    const lastHeard = heard.at(-1)!;
    expect(lastHeard.path).toBe("take.mkv");
    expect(lastHeard.doneSeconds).toBeGreaterThan(1.5);
    expect(lastHeard.totalSeconds).toBeCloseTo(2, 0);
  });
});
