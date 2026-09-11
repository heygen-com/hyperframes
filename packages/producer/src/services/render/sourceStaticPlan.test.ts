import { fixture, eligibility } from "./__test_utils__/sourceStaticPlanFixture.js";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeOpenMaicDiskSchedule,
  resolveOpenMaicStaticPlan,
  verifyDenseFrameDirectory,
} from "./sourceStaticPlan.js";

const scratch: string[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("producer sdr_disk static-plan owner", () => {
  it.each(["", "[]", "[{}]", "{}", "null"])(
    "rejects malformed carrier %s before optimization",
    async (bytes) => {
      const { root } = await fixture(scratch);
      await writeFile(join(root, "openmaic-source-static-plan.json"), bytes);
      expect((await resolveOpenMaicStaticPlan(eligibility(root))).mode).toBe("baseline");
    },
  );
  it("rejects copied frame corruption instead of settling an incomplete optimization", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-corrupt-copy-"));
    scratch.push(root);
    await expect(
      executeOpenMaicDiskSchedule({
        schedule: { items: [{ startFrame: 0, durationFrames: 2 }] },
        framesDir: root,
        extension: "jpg",
        assertNotAborted() {},
        reportFrame() {},
        async capture() {
          await writeFile(join(root, "frame_000000.jpg"), "anchor");
        },
        operations: {
          async link() {
            throw Object.assign(new Error("cross device"), { code: "EXDEV" });
          },
          async copyFile(_source, destination) {
            await writeFile(destination, "corrupt");
          },
        },
      }),
    ).rejects.toThrow("copied frame identity mismatch");
  });

  it("keeps default-off on the complete duration-one schedule without reading a carrier", async () => {
    const result = await resolveOpenMaicStaticPlan(
      eligibility("/missing", { enabled: false, totalFrames: 4 }),
    );
    expect(result).toMatchObject({ mode: "baseline", reason: "disabled" });
    expect(result.items).toEqual(
      Array.from({ length: 4 }, (_, startFrame) => ({ startFrame, durationFrames: 1 })),
    );
  });

  it("accepts a valid carrier and creates a complete schedule", async () => {
    const { root } = await fixture(scratch);
    const result = await resolveOpenMaicStaticPlan(eligibility(root));
    expect(result.mode).toBe("optimized");
    expect(result.items.reduce((sum, item) => sum + item.durationFrames, 0)).toBe(300);
    expect(result.items).toContainEqual({ startFrame: 30, durationFrames: 30 });
  });

  it("reads identities from the extracted project root, not the browser compiled directory", async () => {
    const { root } = await fixture(scratch);
    const compiledDir = await mkdtemp(join(tmpdir(), "openmaic-static-compiled-"));
    scratch.push(compiledDir);
    await writeFile(join(compiledDir, "index.html"), "<p>compiled browser document only</p>");

    await expect(resolveOpenMaicStaticPlan(eligibility(root))).resolves.toMatchObject({
      mode: "optimized",
    });
    await expect(resolveOpenMaicStaticPlan(eligibility(compiledDir))).resolves.toMatchObject({
      mode: "baseline",
      reason: "carrier_unreadable",
    });
  });

  it.each([undefined, "alternate.html", "./index.html"])(
    "rejects an unbound or unsupported render entry %s despite valid index identities",
    async (entryFile) => {
      const { root } = await fixture(scratch);
      const result = await resolveOpenMaicStaticPlan(eligibility(root, { entryFile }));
      expect(result).toMatchObject({ mode: "baseline", reason: "unsupported_entry_file" });
      expect(result.items).toEqual(
        Array.from({ length: 300 }, (_, startFrame) => ({ startFrame, durationFrames: 1 })),
      );
    },
  );

  it("falls back for a validly shaped carrier with zero coverage", async () => {
    const { root, carrier } = await fixture(scratch);
    carrier.intervals = [];
    carrier.identity.sourceAssets = [];
    await writeFile(join(root, "openmaic-source-static-plan.json"), `${JSON.stringify(carrier)}\n`);
    await expect(resolveOpenMaicStaticPlan(eligibility(root))).resolves.toMatchObject({
      mode: "baseline",
      reason: "zero_coverage",
    });
  });

  it.each([
    ["wrong backend", { capturePlanKind: "sdr_streaming" }],
    ["initial streaming provenance", { initialDirectSdrDiskEligible: false }],
    ["wrong fps", { fps: { num: 60, den: 1 } }],
    ["screenshot", { captureMode: "screenshot" }],
    ["force screenshot", { forceScreenshot: true }],
    ["pipelined", { workerEncodeEnabled: true }],
    ["multi-worker", { workerCount: 2 }],
    ["chunk frame range", { frameRange: { startFrame: 0, endFrame: 300 } }],
    ["HF static dedup enabled", { staticDedupEnabled: true }],
    ["HF static dedup", { staticDedupArmed: true }],
  ])("falls back before capture for %s", async (_label, patch) => {
    const { root } = await fixture(scratch);
    const result = await resolveOpenMaicStaticPlan(eligibility(root, patch));
    expect(result.mode).toBe("baseline");
    expect(result.items).toHaveLength(300);
  });

  it("rejects the whole carrier on identity drift instead of accepting a subset", async () => {
    const { root } = await fixture(scratch);
    await writeFile(join(root, "assets/vendor/gsap.min.js"), "altered");
    const result = await resolveOpenMaicStaticPlan(eligibility(root));
    expect(result).toMatchObject({ mode: "baseline", reason: "file_identity_mismatch" });
    expect(result.items.every((item) => item.durationFrames === 1)).toBe(true);
  });

  it("rejects external executable/font closure exactly like the packaging owner", async () => {
    const { root, carrier } = await fixture(scratch);
    const index = Buffer.from(
      '<script src="assets/vendor/gsap.min.js"></script><script src="https://example.com/runtime.js"></script>',
    );
    await writeFile(join(root, "index.html"), index);
    carrier.identity.indexHtml = {
      path: "index.html",
      size: index.length,
      sha256: hash(index),
    };
    await writeFile(join(root, "openmaic-source-static-plan.json"), `${JSON.stringify(carrier)}\n`);

    await expect(resolveOpenMaicStaticPlan(eligibility(root))).resolves.toMatchObject({
      mode: "baseline",
      reason: "external_runtime_dependency",
    });
  });

  it.each([
    ["manifest", "openmaic-video-manifest.json"],
    ["index", "index.html"],
    ["source asset", "assets/slides/页.png"],
  ])("rejects the whole carrier when %s bytes drift", async (_label, path) => {
    const { root } = await fixture(scratch);
    await writeFile(join(root, path), "altered");
    const result = await resolveOpenMaicStaticPlan(eligibility(root));
    expect(result.mode).toBe("baseline");
    expect(result.items).toHaveLength(300);
    expect(result.items.every((item) => item.durationFrames === 1)).toBe(true);
  });

  it("rejects non-exact time-to-frame identity and overlapping intervals as whole plans", async () => {
    const first = await fixture(scratch);
    first.carrier.intervals[0]!.startFrame = 31;
    await writeFile(
      join(first.root, "openmaic-source-static-plan.json"),
      `${JSON.stringify(first.carrier)}\n`,
    );
    await expect(resolveOpenMaicStaticPlan(eligibility(first.root))).resolves.toMatchObject({
      mode: "baseline",
      reason: "scene_asset_binding",
    });

    const second = await fixture(scratch);
    second.carrier.intervals.push({
      ...second.carrier.intervals[0]!,
      startMs: 1500,
      endMs: 2500,
      startFrame: 45,
      endExclusiveFrame: 75,
    });
    await writeFile(
      join(second.root, "openmaic-source-static-plan.json"),
      `${JSON.stringify(second.carrier)}\n`,
    );
    await expect(resolveOpenMaicStaticPlan(eligibility(second.root))).resolves.toMatchObject({
      mode: "baseline",
      reason: "interval_structure",
    });
  });

  it("materializes dense frames and advances logical progress", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmaic-static-frames-"));
    scratch.push(root);
    const progress: number[] = [];
    const result = await executeOpenMaicDiskSchedule({
      schedule: {
        items: [
          { startFrame: 0, durationFrames: 3 },
          { startFrame: 3, durationFrames: 1 },
        ],
      },
      framesDir: root,
      extension: "jpg",
      assertNotAborted() {},
      async capture(index) {
        await writeFile(
          join(root, `frame_${String(index).padStart(6, "0")}.jpg`),
          `frame-${index}`,
        );
      },
      async reportFrame(index) {
        progress.push(index + 1);
      },
    });
    expect(result).toEqual({ physicalCaptures: 2, linkedFrames: 2, copiedFrames: 0 });
    expect(progress).toEqual([1, 2, 3, 4]);
    await expect(verifyDenseFrameDirectory(root, 4, "jpg")).resolves.toBeUndefined();
    expect(await readFile(join(root, "frame_000002.jpg"), "utf8")).toBe("frame-0");
  });

  it.each([
    {
      label: "static -> video",
      totalFrames: 9,
      activeStart: 3,
      activeEnd: 6,
      items: [
        { startFrame: 0, durationFrames: 3 },
        ...Array.from({ length: 6 }, (_, offset) => ({
          startFrame: offset + 3,
          durationFrames: 1,
        })),
      ],
      expectedCaptures: [0, 3, 4, 5, 6, 7, 8],
    },
    {
      label: "video -> static",
      totalFrames: 9,
      activeStart: 0,
      activeEnd: 3,
      items: [
        { startFrame: 0, durationFrames: 1 },
        { startFrame: 1, durationFrames: 1 },
        { startFrame: 2, durationFrames: 1 },
        { startFrame: 3, durationFrames: 3 },
        { startFrame: 6, durationFrames: 1 },
        { startFrame: 7, durationFrames: 1 },
        { startFrame: 8, durationFrames: 1 },
      ],
      expectedCaptures: [0, 1, 2, 3, 6, 7, 8],
    },
    {
      label: "static -> video -> static",
      totalFrames: 12,
      activeStart: 3,
      activeEnd: 6,
      items: [
        { startFrame: 0, durationFrames: 3 },
        { startFrame: 3, durationFrames: 1 },
        { startFrame: 4, durationFrames: 1 },
        { startFrame: 5, durationFrames: 1 },
        { startFrame: 6, durationFrames: 3 },
        { startFrame: 9, durationFrames: 1 },
        { startFrame: 10, durationFrames: 1 },
        { startFrame: 11, durationFrames: 1 },
      ],
      expectedCaptures: [0, 3, 4, 5, 6, 9, 10, 11],
    },
  ])(
    "preserves absolute-time video injector update/clear semantics for $label",
    async ({ totalFrames, activeStart, activeEnd, items, expectedCaptures }) => {
      const root = await mkdtemp(join(tmpdir(), "openmaic-static-video-boundaries-"));
      scratch.push(root);
      const captures: number[] = [];
      const activeVideoFrames: { index: number; timeSeconds: number; active: boolean }[] = [];
      const progress: number[] = [];
      await executeOpenMaicDiskSchedule({
        schedule: { items },
        framesDir: root,
        extension: "jpg",
        assertNotAborted() {},
        async capture(index) {
          captures.push(index);
          // captureFrame receives absolute timeline time in the generated owner;
          // model the unchanged producer injector's update/clear decision at that time.
          activeVideoFrames.push({
            index,
            timeSeconds: index / 30,
            active: index >= activeStart && index < activeEnd,
          });
          await writeFile(join(root, `frame_${String(index).padStart(6, "0")}.jpg`), `f-${index}`);
        },
        reportFrame(index) {
          progress.push(index + 1);
        },
      });

      expect(captures).toEqual(expectedCaptures);
      expect(activeVideoFrames).toEqual(
        expectedCaptures.map((index) => ({
          index,
          timeSeconds: index / 30,
          active: index >= activeStart && index < activeEnd,
        })),
      );
      expect(progress).toEqual(Array.from({ length: totalFrames }, (_, index) => index + 1));
      await expect(verifyDenseFrameDirectory(root, totalFrames, "jpg")).resolves.toBeUndefined();
    },
  );

  it("uses only an allowed copy fallback and rejects unexpected link failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmaic-static-copy-"));
    scratch.push(root);
    const exdev = Object.assign(new Error("cross-device"), { code: "EXDEV" });
    const copied = await executeOpenMaicDiskSchedule({
      schedule: { items: [{ startFrame: 0, durationFrames: 2 }] },
      framesDir: root,
      extension: "jpg",
      assertNotAborted() {},
      async capture() {
        await writeFile(join(root, "frame_000000.jpg"), "anchor");
      },
      async reportFrame() {},
      operations: {
        async link() {
          throw exdev;
        },
      },
    });
    expect(copied.copiedFrames).toBe(1);

    const second = await mkdtemp(join(tmpdir(), "openmaic-static-failure-"));
    scratch.push(second);
    const eio = Object.assign(new Error("io"), { code: "EIO" });
    await expect(
      executeOpenMaicDiskSchedule({
        schedule: { items: [{ startFrame: 0, durationFrames: 2 }] },
        framesDir: second,
        extension: "jpg",
        assertNotAborted() {},
        async capture() {
          await writeFile(join(second, "frame_000000.jpg"), "anchor");
        },
        async reportFrame() {},
        operations: {
          async link() {
            throw eio;
          },
        },
      }),
    ).rejects.toMatchObject({ code: "EIO" });
    await rm(second, { recursive: true, force: true });
    await expect(stat(second)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
