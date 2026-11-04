import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openProjectHistory } from "./projectHistory";
import { reclaimUncopiedBlobs } from "./reclaimUncopied";
import { START } from "./historyLog";

const MiB = 1024 ** 2;
const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const blobFile = (home: string, content: Buffer) => {
  const hash = createHash("sha256").update(content).digest("hex");
  return join(home, "blobs", hash.slice(0, 2), hash);
};

/** A closed history as an older version left it: the media's bytes sit in the blob store next to the text. */
async function closedHistoryWithOldMediaCopy() {
  const projectDir = tempDir("hf-reclaim-project-");
  const historyRoot = tempDir("hf-reclaim-root-");
  const media = Buffer.alloc(2 * MiB, 5);
  writeFileSync(join(projectDir, "index.html"), "A");
  writeFileSync(join(projectDir, "clip.mp4"), media);
  const history = await openProjectHistory({ projectDir, historyRoot, quietMs: 30 });
  await vi.waitFor(() => expect(history.peek(START)).toHaveProperty(["clip.mp4"]), {
    timeout: 10_000,
  });
  await history.close();
  const home = join(historyRoot, history.projectId);
  const copy = blobFile(home, media);
  mkdirSync(join(copy, ".."), { recursive: true });
  writeFileSync(copy, media);
  return { historyRoot, home, copy, text: blobFile(home, Buffer.from("A")) };
}

describe("reclaimUncopiedBlobs", () => {
  it("lists the bytes of old media copies in every history and removes nothing on a dry run", async () => {
    const { historyRoot, copy } = await closedHistoryWithOldMediaCopy();
    const found = await reclaimUncopiedBlobs(historyRoot, { dryRun: true });
    expect(found.map((history) => history.bytes)).toEqual([2 * MiB]);
    expect(existsSync(copy)).toBe(true);
  });

  it("removes the media copies of a history nobody has open, and keeps its text copies", async () => {
    const { historyRoot, copy, text } = await closedHistoryWithOldMediaCopy();
    await reclaimUncopiedBlobs(historyRoot);
    expect(existsSync(copy)).toBe(false);
    expect(existsSync(text)).toBe(true);
    expect(await reclaimUncopiedBlobs(historyRoot)).toEqual([]);
  });
});
