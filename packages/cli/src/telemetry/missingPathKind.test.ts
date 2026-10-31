import { describe, expect, it } from "vitest";
import { missingPathKind } from "./missingPathKind.js";

const enoent = (path: string) =>
  Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
    code: "ENOENT",
    path,
  });

describe("missingPathKind", () => {
  it.each([
    [
      "C:\\Users\\a\\AppData\\Local\\Temp\\hf-cache\\hfcache-v8-0a1b2c\\frame_000041.jpg",
      "extract_cache",
    ],
    [
      "/tmp/hf-render-Ab12Cd/compiled/__hyperframes_video_frames/v-s0/frame_000041.jpg",
      "video_frames",
    ],
    [
      "/proj/work-0a1b2c3d-1111-2222-3333-444455556666-Xy12Ab/captured-frames/frame_005280.jpg",
      "captured_frames",
    ],
    ["C:\\Temp\\hf-render-Ab12Cd\\capture-attempt-1\\worker-3\\frame_000007.jpg", "worker_frames"],
    ["/tmp/hf-render-Ab12Cd/capture-calibration/frame_000001.jpg", "calibration"],
    ["/tmp/hf-render-Ab12Cd/compiled/index.html", "compiled"],
    ["/tmp/hf-render-Ab12Cd/audio-work/mix.wav", "work_dir"],
    ["/Users/a/Projects/Launch/assets/intro.mp4", "other"],
  ])("names %s as %s", (path, kind) => {
    expect(missingPathKind(enoent(path))).toBe(kind);
  });

  it("finds the missing file in an error's causes and in a message that only names it", () => {
    const wrapped = new Error("[Parallel] Capture failed", {
      cause: enoent("/tmp/hf-render-x/captured-frames/frame_1.jpg"),
    });
    expect(missingPathKind(wrapped)).toBe("captured_frames");
    expect(
      missingPathKind(
        new Error("ENOENT: no such file or directory, open 'C:\\T\\hfcache-v8-ab\\frame_2.jpg'"),
      ),
    ).toBe("extract_cache");
  });

  it("names nothing when no file was missing", () => {
    expect(missingPathKind(new Error("Composition has zero duration"))).toBeUndefined();
    expect(
      missingPathKind(Object.assign(new Error("EPERM: rename"), { code: "EPERM" })),
    ).toBeUndefined();
  });
});
