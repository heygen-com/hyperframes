import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { AUDIO_SIDECAR_MIN_BYTES } from "@hyperframes/producer/distributed";
import { audioSidecarUri } from "../contentStore.js";
import { parseSiteManifest } from "../siteManifest.js";
import { asS3Client, FakeS3 } from "./__fixtures__/fakeS3.js";
import { deploySite } from "./deploySite.js";

let projectDir: string;
let scratch: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hf-deploy-site-test-"));
  scratch = mkdtempSync(join(tmpdir(), "hf-deploy-site-scratch-"));
  mkdirSync(join(projectDir, "assets"));
  writeFileSync(join(projectDir, "index.html"), "<html><body>hi</body></html>");
  writeFileSync(join(projectDir, "assets", "style.css"), "body { color: red; }");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function storeKey(text: string): string {
  const digest = sha256(text);
  return `cas/sha256/${digest.slice(0, 2)}/${digest}`;
}

function sitePaths(s3: FakeS3, siteId: string): string[] {
  const manifest = s3.bodies.get(`test-bucket/sites/${siteId}/files.json`)?.toString() ?? "";
  return parseSiteManifest(manifest).map((file) => file.path);
}

const HTML = "<html><body>hi</body></html>";
const CSS = "body { color: red; }";

describe("deploySite", () => {
  it("uploads each file once under its content hash, then the site manifest", async () => {
    const s3 = new FakeS3();
    const result = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3),
    });

    expect(result.uploaded).toBe(true);
    expect(result.siteId).toMatch(/^[0-9a-f]{16}$/);
    expect(result.bucketName).toBe("test-bucket");
    expect(result.projectS3Uri).toBe(`s3://test-bucket/sites/${result.siteId}/files.json`);
    expect(result.bytes).toBe(HTML.length + CSS.length);
    const puts = s3.ops.filter((op) => op.kind === "put").map((op) => op.key);
    expect(puts.slice(0, 2).sort()).toEqual([storeKey(HTML), storeKey(CSS)].sort());
    expect(puts[2]).toBe(`sites/${result.siteId}/files.json`);
    expect(s3.bodies.get(`test-bucket/${storeKey(CSS)}`)?.toString()).toBe(CSS);
    expect(parseSiteManifest(s3.bodies.get(`test-bucket/${puts[2]}`)?.toString() ?? "")).toEqual([
      { path: "assets/style.css", sha256: sha256(CSS), sizeBytes: CSS.length },
      { path: "index.html", sha256: sha256(HTML), sizeBytes: HTML.length },
    ]);
  });

  it("skips a file another site already stored", async () => {
    const s3 = new FakeS3();
    const cssId = `test-bucket/${storeKey(CSS)}`;
    s3.existing.add(cssId);
    s3.bodies.set(cssId, Buffer.from(CSS));
    s3.metadata.set(cssId, { sha256: sha256(CSS) });

    await deploySite({ projectDir, bucketName: "test-bucket", s3: asS3Client(s3) });

    const puts = s3.ops.filter((op) => op.kind === "put").map((op) => op.key);
    expect(puts).toHaveLength(2);
    expect(puts).not.toContain(storeKey(CSS));
    expect(puts).toContain(storeKey(HTML));
  });

  it("yields a stable siteId across re-runs of the same tree", async () => {
    const s3a = new FakeS3();
    const a = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3a),
    });
    const s3b = new FakeS3();
    const b = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3b),
    });
    expect(a.siteId).toBe(b.siteId);
  });

  it("changes siteId when a file's content changes", async () => {
    const s3 = new FakeS3();
    const before = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3),
    });

    writeFileSync(join(projectDir, "index.html"), "<html><body>changed</body></html>");
    const s3b = new FakeS3();
    const after = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3b),
    });
    expect(after.siteId).not.toBe(before.siteId);
  });

  it("uploads nothing when the same tree is deployed again", async () => {
    const s3 = new FakeS3();
    const first = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3),
    });

    const second = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3),
    });

    expect(second.uploaded).toBe(false);
    expect(second.siteId).toBe(first.siteId);
    // Two files plus the manifest, each put once and HEAD-checked on both deploys.
    expect(s3.ops.filter((op) => op.kind === "put")).toHaveLength(3);
    expect(s3.ops.filter((op) => op.kind === "head")).toHaveLength(6);
  });

  it("honours a caller-supplied siteId", async () => {
    const s3 = new FakeS3();
    const result = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      siteId: "release-v1.2.3",
      s3: asS3Client(s3),
    });
    expect(result.siteId).toBe("release-v1.2.3");
    expect(result.projectS3Uri).toBe("s3://test-bucket/sites/release-v1.2.3/files.json");
  });

  it("propagates non-404 S3 errors", async () => {
    const errS3 = {
      async send(_cmd: unknown): Promise<unknown> {
        const err = new Error("Access Denied") as Error & {
          $metadata: { httpStatusCode: number };
        };
        err.$metadata = { httpStatusCode: 403 };
        throw err;
      },
    };
    await expect(
      deploySite({
        projectDir,
        bucketName: "test-bucket",
        s3: errS3 as unknown as S3Client,
      }),
    ).rejects.toThrow(/Access Denied/);
  });

  it("ignores SKIP_TOP_LEVEL dirs when hashing", async () => {
    const s3 = new FakeS3();
    const before = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3),
    });

    mkdirSync(join(projectDir, "node_modules"));
    writeFileSync(join(projectDir, "node_modules", "junk.bin"), "x".repeat(100));
    const s3b = new FakeS3();
    const after = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3b),
    });

    // node_modules contents shouldn't move the hash.
    expect(after.siteId).toBe(before.siteId);
  });

  it("ships a symlinked project and its symlinked files and folders as content", async () => {
    mkdirSync(join(scratch, "media"));
    writeFileSync(join(scratch, "media", "clip.txt"), "clip");
    writeFileSync(join(scratch, "logo.txt"), "logo");
    symlinkSync(join(scratch, "media"), join(projectDir, "media"));
    symlinkSync(join(scratch, "logo.txt"), join(projectDir, "logo.txt"));
    symlinkSync(projectDir, join(scratch, "fx"));
    const s3 = new FakeS3();
    const result = await deploySite({
      projectDir: join(scratch, "fx"),
      bucketName: "test-bucket",
      s3: asS3Client(s3),
    });
    expect(sitePaths(s3, result.siteId)).toEqual([
      "assets/style.css",
      "index.html",
      "logo.txt",
      "media/clip.txt",
    ]);
  });
});

const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || "ffmpeg";
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"]).status === 0;

describe.skipIf(!HAS_FFMPEG)("deploySite audio sidecars", { timeout: 60_000 }, () => {
  function addLargeVideo(): void {
    const made = spawnSync(FFMPEG, [
      ...[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=gray:size=640x360:rate=25:duration=30,noise=alls=100:allf=t+u",
      ],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=30"],
      ...["-c:v", "mpeg4", "-b:v", "16M", "-c:a", "aac", join(projectDir, "assets", "take.mp4")],
    ]);
    expect(made.status).toBe(0);
  }

  it("stores a large video's audio beside it, and leaves the site's file list as it was", async () => {
    addLargeVideo();
    const s3 = new FakeS3();
    const site = await deploySite({ projectDir, bucketName: "test-bucket", s3: asS3Client(s3) });

    const take = parseSiteManifest(
      s3.bodies.get(`test-bucket/sites/${site.siteId}/files.json`)?.toString() ?? "",
    ).find((file) => file.path === "assets/take.mp4");
    expect(take?.sizeBytes).toBeGreaterThan(AUDIO_SIDECAR_MIN_BYTES);
    const sidecar = audioSidecarUri("test-bucket", take?.sha256 ?? "").replace("s3://", "");
    expect(s3.existing.has(sidecar)).toBe(true);
    expect(s3.bodies.get(sidecar)?.length).toBeLessThan((take?.sizeBytes ?? 0) / 4);
    expect(sitePaths(s3, site.siteId)).toEqual([
      "assets/style.css",
      "assets/take.mp4",
      "index.html",
    ]);
  });

  it("deploys the same site with no sidecar when there is no ffmpeg, and says so", async () => {
    addLargeVideo();
    const notices: string[] = [];
    const before = process.env.HYPERFRAMES_FFMPEG_PATH;
    process.env.HYPERFRAMES_FFMPEG_PATH = join(scratch, "no-such-ffmpeg");
    const s3 = new FakeS3();
    try {
      await deploySite({
        projectDir,
        bucketName: "test-bucket",
        s3: asS3Client(s3),
        onNotice: (message) => notices.push(message),
      });
    } finally {
      if (before === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
      else process.env.HYPERFRAMES_FFMPEG_PATH = before;
    }

    expect([...s3.existing].filter((id) => id.endsWith(".audio.m4a"))).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("ffmpeg");
  });
});
