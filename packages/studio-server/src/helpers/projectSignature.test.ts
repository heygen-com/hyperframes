import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { affectsProjectSignature } from "./projectSignature.js";

const PROJECT = resolve("/projects/demo");
const affects = (relativePath: string) =>
  affectsProjectSignature(PROJECT, resolve(PROJECT, relativePath));

describe("affectsProjectSignature", () => {
  it("accepts a file the signature walk collects", () => {
    expect(affects("index.html")).toBe(true);
    expect(affects("assets/logo.png")).toBe(true);
  });

  it("rejects the caches the walk skips", () => {
    // .thumbnails is the one that matters: the thumbnail route writes a capture
    // there and reads the preview on the next one, so invalidating on it throws
    // the memo away on roughly every request of the workload it exists for.
    expect(affects(".thumbnails/frame-0.jpg")).toBe(false);
    expect(affects("node_modules/pkg/index.js")).toBe(false);
    expect(affects("renders/out.mp4")).toBe(false);
  });

  it("rejects a directory event on an excluded dir itself", () => {
    expect(affects(".thumbnails")).toBe(false);
  });

  it("accepts the two manifest files the signature reads back out of .hyperframes", () => {
    // The reload watcher's exclusion set is character-identical to the walk's but
    // drops all of .hyperframes/. Filtering with it would stop a motion-state save
    // from ever invalidating — the same stale-ETag bug in a new place.
    expect(affects(".hyperframes/studio-motion.json")).toBe(true);
    expect(affects(".hyperframes/studio-manual-edits.json")).toBe(true);
  });

  it("rejects everything else inside .hyperframes", () => {
    expect(affects(".hyperframes/cache/blob.bin")).toBe(false);
  });

  it("rejects a path outside the project", () => {
    expect(affectsProjectSignature(PROJECT, resolve("/projects/other/index.html"))).toBe(false);
    expect(affectsProjectSignature(PROJECT, PROJECT)).toBe(false);
  });
});
