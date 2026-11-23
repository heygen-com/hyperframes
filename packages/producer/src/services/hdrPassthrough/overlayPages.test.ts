import { describe, expect, it } from "bun:test";
import {
  type CaptureOptions,
  type ReferenceBackground,
  createReferenceBackgroundRecorder,
} from "@hyperframes/engine";
import { mirrorReferenceBackground, overlayPageOptions } from "./overlayPages.js";

const solid: ReferenceBackground = { kind: "solid", rgb: [9, 8, 7] };

describe("mirrorReferenceBackground", () => {
  it("reads when no session has, and records only on commit", async () => {
    const records: unknown[] = [];
    const recorder = createReferenceBackgroundRecorder((result) => records.push(result));
    const mirror = mirrorReferenceBackground(recorder);
    let reads = 0;
    await mirror.recordOnPage?.(async () => {
      reads++;
      return solid;
    });
    expect(reads).toBe(1);
    expect(recorder.started).toBe(false);
    expect(records).toEqual([]);
    await mirror.commit();
    expect(records).toEqual([{ reference_background: solid }]);
  });

  it("skips the read, as the layered session would, once a session has read", async () => {
    const records: unknown[] = [];
    const recorder = createReferenceBackgroundRecorder((result) => records.push(result));
    await recorder(async () => ({ kind: "none" }));
    const mirror = mirrorReferenceBackground(recorder);
    let reads = 0;
    await mirror.recordOnPage?.(async () => {
      reads++;
      return solid;
    });
    await mirror.commit();
    expect(reads).toBe(0);
    expect(records).toEqual([{ reference_background: { kind: "none" } }]);
  });

  it("reads nothing when the render records nothing, and refuses a recorder it cannot ask", () => {
    expect(mirrorReferenceBackground(undefined).recordOnPage).toBeUndefined();
    expect(() => mirrorReferenceBackground(async () => undefined)).toThrow(/not shareable/);
  });
});

describe("overlayPageOptions", () => {
  it("replaces the recorder and gives the page copies of the shared memos", () => {
    const checks = new Map([["k", Promise.resolve(null)]]);
    const options = {
      width: 4,
      height: 4,
      fps: { num: 30, den: 1 },
      recordReferenceBackground: async () => undefined,
      subTimelineWaitMemo: { unregisteredIds: ["a"], loggedSceneCallbackErrors: ["e"] },
      staticDedupMemo: { checks },
    } as unknown as CaptureOptions;
    const page = overlayPageOptions(options, undefined);
    expect(page.recordReferenceBackground).toBeUndefined();
    expect(page.width).toBe(4);
    // The page sees what is there already...
    expect(page.subTimelineWaitMemo?.unregisteredIds).toEqual(["a"]);
    expect(page.staticDedupMemo?.checks?.get("k")).toBe(checks.get("k")!);
    // ...and what it adds stays its own.
    page.subTimelineWaitMemo!.unregisteredIds = ["b"];
    page.subTimelineWaitMemo!.loggedSceneCallbackErrors!.push("f");
    page.staticDedupMemo!.checks!.set("j", Promise.resolve(null));
    expect(options.subTimelineWaitMemo).toEqual({
      unregisteredIds: ["a"],
      loggedSceneCallbackErrors: ["e"],
    });
    expect([...checks.keys()]).toEqual(["k"]);
  });
});
