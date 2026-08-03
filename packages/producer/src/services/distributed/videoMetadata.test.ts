import { describe, expect, it } from "bun:test";
import {
  createFrameLookupTable,
  type ExtractedFrames,
  type VideoElement,
} from "@hyperframes/engine";
import {
  buildPlanVideosJson,
  parsePlanVideosJson,
  PlanVideosMetadataError,
  type PlanVideosJson,
} from "./shared.js";

function video(overrides: Partial<VideoElement> = {}): VideoElement {
  return {
    id: "hero",
    src: "hero.mp4",
    start: 2,
    end: Number.POSITIVE_INFINITY,
    mediaStart: 1,
    loop: false,
    hasAudio: false,
    ...overrides,
  };
}

function extractedMetadata(
  overrides: Partial<PlanVideosJson["extracted"][number]> = {},
): PlanVideosJson["extracted"][number] {
  return {
    videoId: "hero",
    srcPath: "/plan/video-frames/hero",
    framePattern: "frame_%05d.jpg",
    fps: 2,
    totalFrames: 4,
    metadata: {
      durationSeconds: 3,
      videoStreamDurationSeconds: 3,
      width: 16,
      height: 16,
      fps: 2,
      videoCodec: "h264",
      hasAudio: false,
      isVFR: false,
      hasAlpha: false,
      colorSpace: null,
    },
    ...overrides,
  };
}

function extractedFrames(metadata: PlanVideosJson["extracted"][number]): ExtractedFrames {
  return {
    ...metadata,
    outputDir: metadata.srcPath,
    framePaths: new Map([
      [0, "frame-0.jpg"],
      [1, "frame-1.jpg"],
      [2, "frame-2.jpg"],
      [3, "frame-3.jpg"],
    ]),
  };
}

describe("distributed video metadata", () => {
  it.each([false, true])("bounds an open-ended %s clip at the finite composition end", (loop) => {
    const result = buildPlanVideosJson({
      videos: [video({ loop })],
      extracted: [extractedMetadata()],
      compositionEnd: 8,
    });

    expect(result.videos[0]?.end).toBe(8);
    expect(result.videos[0]?.loop).toBe(loop);
    expect(JSON.stringify(result)).toContain('"end":8');
    expect(JSON.stringify(result)).not.toContain('"end":null');
  });

  it("preserves authored and source-derived finite ends exactly", () => {
    const authored = buildPlanVideosJson({
      videos: [video({ end: 7 })],
      extracted: [extractedMetadata()],
      compositionEnd: 8,
    });
    const sourceDerived = buildPlanVideosJson({
      // A 3s source trimmed by mediaStart=1 has 2s remaining: [2, 4].
      videos: [video({ end: 4 })],
      extracted: [extractedMetadata()],
      compositionEnd: 8,
    });

    expect(authored.videos[0]?.end).toBe(7);
    expect(sourceDerived.videos[0]?.end).toBe(4);
    expect(sourceDerived.videos[0]?.mediaStart).toBe(1);
  });

  it("round-trips a non-zero video stream start and defaults legacy plans to zero", () => {
    const withStart = buildPlanVideosJson({
      videos: [video()],
      extracted: [
        extractedMetadata({
          metadata: {
            ...extractedMetadata().metadata,
            videoStreamStartSeconds: 5,
          },
        }),
      ],
      compositionEnd: 8,
    });
    expect(parsePlanVideosJson(withStart).extracted[0]?.metadata.videoStreamStartSeconds).toBe(5);

    const legacy = structuredClone(withStart);
    delete legacy.extracted[0]?.metadata.videoStreamStartSeconds;
    expect(parsePlanVideosJson(legacy).extracted[0]?.metadata.videoStreamStartSeconds).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, 2])(
    "fails closed when no safe composition boundary can be derived (%s)",
    (compositionEnd) => {
      expect(() =>
        buildPlanVideosJson({
          videos: [video()],
          extracted: [extractedMetadata()],
          compositionEnd,
        }),
      ).toThrow(PlanVideosMetadataError);
    },
  );

  it("rejects serialized null timing and missing extracted frames", () => {
    const valid = buildPlanVideosJson({
      videos: [video()],
      extracted: [extractedMetadata()],
      compositionEnd: 8,
    });

    expect(() =>
      parsePlanVideosJson({
        ...valid,
        videos: [{ ...valid.videos[0], end: null }],
      }),
    ).toThrow(/end must be a finite number/);
    expect(() => parsePlanVideosJson({ videos: valid.videos, extracted: [] })).toThrow(
      /is missing declared video/,
    );
  });

  it.each([
    { loop: false, expectedFrame: 3 },
    { loop: true, expectedFrame: 2 },
  ])(
    "keeps v1 frame injection active through the bounded open-ended clip ($loop)",
    ({ loop, expectedFrame }) => {
      const metadata = extractedMetadata();
      const result = buildPlanVideosJson({
        videos: [video({ loop })],
        extracted: [metadata],
        compositionEnd: 8,
      });
      const lookup = createFrameLookupTable(result.videos, [extractedFrames(metadata)]);

      expect(lookup.getActiveFramePayloads(7).get("hero")?.frameIndex).toBe(expectedFrame);
      expect(lookup.getFrame("hero", 8)).not.toBeNull();
      expect(lookup.getFrame("hero", 8.01)).toBeNull();
    },
  );
});
