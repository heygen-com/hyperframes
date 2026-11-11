import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { shareContentFingerprint } from "../share/render.js";
import type { ShareState } from "../share/service.js";
import { presentPortableShare } from "./shareFreshness.js";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const state: ShareState = {
  upToDate: false,
  share: {
    projectId: "project",
    url: "https://hyperframes.dev/r/test",
    access: "private",
    role: "viewer",
    commentsOn: true,
    space: null,
    elsewhere: false,
    held: false,
  },
  source: {
    at: "ready",
    snapshot: { space_id: "space", composition_id: "composition", snapshot_id: "snapshot" },
  },
  version: {
    last: { exportedAt: "2026-11-06T00:00:00Z", current: true },
    source: "ready",
    exporting: null,
    failure: null,
  },
  pending: null,
  state: "ready",
  ready: true,
  url: "https://hyperframes.dev/r/test",
  previousUrl: null,
  manageUrl: "https://hyperframes.dev/shares",
};
it.each([".media/voice.mp3", ".hyperframes/studio-manual-edits.json"])(
  "detects %s edits even while the Desktop watcher still says current",
  async (path) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "hf-studio-freshness-")));
    dirs.push(dir);
    writeFileSync(join(dir, "index.html"), '<audio src=".media/voice.mp3"></audio>');
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), "original");
    const contentFingerprint = (await shareContentFingerprint(dir))!;
    let checksum = "uploaded-video";
    const deps = {
      render: () => ({
        id: "render",
        path: "video.mp4",
        fingerprint: "watcher",
        contentFingerprint,
      }),
      fingerprint: shareContentFingerprint,
      uploaded: async () => ({
        projectId: "project",
        exportedAt: "2026-11-06T00:00:00Z",
        fingerprint: "watcher",
        versionId: "version",
        checksum: "uploaded-video",
      }),
      checksum: async () => checksum,
    };
    expect((await presentPortableShare(dir, state, deps)).changed).toBeNull();
    writeFileSync(join(dir, path), "changed");
    expect((await presentPortableShare(dir, state, deps)).changed).toBe(true);
    // Another command replaced the render pointer while the original video uploaded.
    checksum = "different-video";
    expect((await presentPortableShare(dir, state, deps)).changed).toBeNull();
  },
);
