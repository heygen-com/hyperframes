import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => [] as string[]);
vi.mock("./media.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./media.js")>();
  return {
    ...real,
    probeVideo: (path: string) => {
      probes.push(path);
      throw new Error("not probed in this test");
    },
  };
});

const { ledgerMediaFile, placeClips } = await import("./person.js");

const MP4_HEAD = Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex");
const roots: string[] = [];
afterEach(() => {
  probes.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hf-ledger-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, "clips"), { recursive: true });
  mkdirSync(join(dir, ".hyperframes"), { recursive: true });
  mkdirSync(join(root, "outside"));
  writeFileSync(join(dir, "clips", "take.mp4"), MP4_HEAD);
  writeFileSync(join(dir, ".hyperframes", "take.mp4"), MP4_HEAD);
  writeFileSync(join(root, "outside", "take.mp4"), MP4_HEAD);
  return { root, dir };
}

describe("ledgerMediaFile", () => {
  it("opens a regular media file inside the project", async () => {
    const { dir } = project();
    expect(await ledgerMediaFile(dir, "clips/take.mp4")).toBe(join(dir, "clips", "take.mp4"));
  });

  it.each([
    ["a path that climbs out", "../outside/take.mp4"],
    ["an absolute path outside", "/etc/hosts"],
    ["a private file", ".hyperframes/take.mp4"],
    ["a folder", "clips"],
    ["a missing file", "clips/missing.mp4"],
  ])("refuses %s", async (_, path) => {
    const { dir } = project();
    expect(await ledgerMediaFile(dir, path)).toBeNull();
  });

  it.skipIf(process.platform === "win32")("refuses a link inside that leads outside", async () => {
    const { root, dir } = project();
    symlinkSync(join(root, "outside", "take.mp4"), join(dir, "clips", "link.mp4"));
    expect(await ledgerMediaFile(dir, "clips/link.mp4")).toBeNull();
  });

  it.skipIf(process.platform === "win32")("refuses a pipe without opening it", async () => {
    const { dir } = project();
    execFileSync("mkfifo", [join(dir, "clips", "pipe.mp4")]);
    const started = performance.now();
    expect(await ledgerMediaFile(dir, "clips/pipe.mp4")).toBeNull();
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("refuses a playlist that names a file outside its folder", async () => {
    const { dir } = project();
    writeFileSync(join(dir, "clips", "list.mp4"), "#EXTM3U\n../../outside/take.mp4\n");
    expect(await ledgerMediaFile(dir, "clips/list.mp4")).toBeNull();
  });
});

describe("placeClips", () => {
  it("reports a clip or still outside the project as not in it, without running ffprobe", async () => {
    const { dir } = project();
    const ref = { path: join(dir, "clips", "take.mp4"), audio: false } as Parameters<
      typeof placeClips
    >[2];
    const placed = await placeClips(
      [
        { path: "../outside/take.mp4", reference: "../outside/take.mp4" },
        { path: ".hyperframes/take.mp4" },
      ],
      dir,
      ref,
      [],
    );
    expect(placed.map((c) => c.note)).toEqual([
      "the clip's file is not in the project",
      "the clip's file is not in the project",
    ]);
    expect(placed.every((c) => c.still === undefined)).toBe(true);
    expect(probes).toEqual([]);
  });
});
