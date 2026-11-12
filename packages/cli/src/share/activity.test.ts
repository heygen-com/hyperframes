import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readShareActivity, withShareActivity } from "./activity.js";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function folder() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "hf-share-activity-")));
  dirs.push(dir);
  return dir;
}
it("exposes preparation, rendering and upload until completion, then clears status", async () => {
  const dir = await folder();
  await withShareActivity(dir, async (phase) => {
    expect((await readShareActivity(dir))?.step).toBe("preparing");
    await phase("rendering");
    expect((await readShareActivity(dir))?.step).toBe("rendering");
    await phase("uploading_source");
    expect((await readShareActivity(dir))?.step).toBe("uploading_source");
    await expect(withShareActivity(dir, async () => {})).rejects.toThrow("Another process");
  });
  expect(await readShareActivity(dir)).toBeNull();
});
it("clears a failed attempt and ignores stale records for dead processes", async () => {
  const dir = await folder();
  await expect(
    withShareActivity(dir, async () => {
      throw new Error("upload refused");
    }),
  ).rejects.toThrow("upload refused");
  expect(await readShareActivity(dir)).toBeNull();
  await writeFile(
    join(dir, ".hyperframes", "share-activity.json"),
    JSON.stringify({
      step: "rendering",
      pid: 2147483647,
      hostname: (await import("node:os")).hostname(),
      startedAt: "now",
      updatedAt: Date.now(),
    }),
  );
  expect(await readShareActivity(dir)).toBeNull();
});

it("ignores an expired heartbeat even when the process is alive", async () => {
  const dir = await folder();
  await withShareActivity(dir, async () => {
    await writeFile(
      join(dir, ".hyperframes", "share-activity.json"),
      JSON.stringify({
        step: "rendering",
        pid: process.pid,
        hostname: hostname(),
        startedAt: "now",
        updatedAt: Date.now() - 61000,
      }),
    );
    expect(await readShareActivity(dir)).toBeNull();
  });
});
