import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { planV2WithPublisher } from "./planV2.js";
import type { PlanV2ArtifactPublisher, PlanV2PublishBlob } from "./planV2Publisher.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const root = mkdtempSync(join(tmpdir(), "hf-plan-remote-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

class RecordingPublisher implements PlanV2ArtifactPublisher {
  readonly put = new Map<string, Buffer>();
  readonly referenced: string[] = [];
  manifest:
    | { sourcePlanV1Hash: string; artifacts: { path: string; sha256: string; sizeBytes: number }[] }
    | undefined;

  async putBlob(blob: Readonly<PlanV2PublishBlob>): Promise<void> {
    this.put.set(blob.sha256, readFileSync(blob.sourcePath));
  }
  async referenceStoredBlob(blob: Readonly<Omit<PlanV2PublishBlob, "sourcePath">>): Promise<void> {
    this.referenced.push(blob.sha256);
  }
  async commitManifest(manifestBytes: string): Promise<void> {
    this.manifest = JSON.parse(manifestBytes);
  }
  async abort(): Promise<void> {}
}

describe("plan v2 with a remote project file", () => {
  it.skipIf(!HAS_FFMPEG)(
    "probes the video by URL and publishes it by digest without reading it into the plan",
    async () => {
      const clip = join(root, "store", "clip.mp4");
      mkdirSync(join(root, "store"), { recursive: true });
      const ffmpeg = spawnSync("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x240:rate=30:duration=3",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        clip,
      ]);
      expect(ffmpeg.status).toBe(0);
      const sha256 = createHash("sha256").update(readFileSync(clip)).digest("hex");
      const sizeBytes = statSync(clip).size;

      const projectDir = join(root, "project");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        join(projectDir, "index.html"),
        `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="3">
    <video id="bg" src="assets/clip.mp4" muted data-start="0" data-duration="3" data-track-index="0"></video>
  </div>
</body></html>`,
      );
      const planWithDigest = async (digest: string) => {
        const publisher = new RecordingPublisher();
        const url = pathToFileURL(clip).href;
        await planV2WithPublisher(
          projectDir,
          { fps: 30, width: 320, height: 240, format: "mp4" },
          publisher,
          { remoteFiles: { "assets/clip.mp4": { url, sha256: digest, sizeBytes } } },
        );
        return publisher;
      };
      const publisher = await planWithDigest(sha256);

      expect(publisher.referenced).toEqual([sha256]);
      expect(publisher.put.has(sha256)).toBe(false);
      expect(publisher.manifest?.artifacts).toContainEqual(
        expect.objectContaining({ path: "compiled/assets/clip.mp4", sha256, sizeBytes }),
      );
      const videosArtifact = publisher.manifest?.artifacts.find(
        (a) => a.path === "meta/videos.json",
      );
      const videos = publisher.put.get(videosArtifact!.sha256)!.toString();
      expect(JSON.parse(videos).extracted[0].deferredRange.sourcePath).toBe(
        "compiled/assets/clip.mp4",
      );
      expect(videos).not.toContain("file:");
      // The remote file's digest is part of the plan's own content hash.
      const other = await planWithDigest("0".repeat(64));
      expect(other.manifest?.sourcePlanV1Hash).not.toBe(publisher.manifest?.sourcePlanV1Hash);
    },
    60_000,
  );
});
