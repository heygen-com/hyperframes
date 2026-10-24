import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { audioSidecarUri, contentStoreUri } from "./contentStore.js";
import { FakeS3 } from "./sdk/__fixtures__/fakeS3.js";
import { downloadSiteFiles, serializeSiteManifest, siteManifestUri } from "./siteManifest.js";

const VIDEO_SHA = "a".repeat(64);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-site-manifest-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A real client, so it can pre-sign offline, whose requests go to the fake. */
function clientOver(fake: FakeS3): S3Client {
  const client = new S3Client({
    region: "us-east-2",
    credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" },
  });
  client.send = fake.send.bind(fake) as S3Client["send"];
  return client;
}

function siteWithVideo(fake: FakeS3): string {
  const manifestUri = siteManifestUri("bucket", "site1");
  const id = manifestUri.replace("s3://", "");
  fake.existing.add(id);
  fake.bodies.set(
    id,
    Buffer.from(
      serializeSiteManifest([{ path: "takes/camera.mov", sha256: VIDEO_SHA, sizeBytes: 9 }]),
    ),
  );
  return manifestUri;
}

describe("downloadSiteFiles", () => {
  it("hands a remote video's audio sidecar along with the video's own URL, when one is stored", async () => {
    const fake = new FakeS3();
    const manifestUri = siteWithVideo(fake);
    fake.existing.add(audioSidecarUri("bucket", VIDEO_SHA).replace("s3://", ""));

    const remote = await downloadSiteFiles(
      clientOver(fake),
      manifestUri,
      join(dir, "project"),
      true,
    );

    const file = remote["takes/camera.mov"];
    expect(file?.url).toContain(contentStoreUri("bucket", VIDEO_SHA).split("/").pop() ?? "");
    expect(file?.audioSidecarUrl).toContain(`${VIDEO_SHA}.audio.m4a`);
  });

  it("hands only the video when no sidecar is stored", async () => {
    const fake = new FakeS3();
    const manifestUri = siteWithVideo(fake);

    const remote = await downloadSiteFiles(
      clientOver(fake),
      manifestUri,
      join(dir, "project"),
      true,
    );

    expect(remote["takes/camera.mov"]?.url).toBeString();
    expect(remote["takes/camera.mov"]?.audioSidecarUrl).toBeUndefined();
  });
});
