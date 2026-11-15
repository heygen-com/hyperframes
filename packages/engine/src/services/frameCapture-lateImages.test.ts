import { describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import {
  ImageMissingFromFrameError,
  waitForShownLateImages,
  type CaptureSession,
} from "./frameCapture.js";

type Reading = { arrived: string[]; waiting: string[]; broken: string[] };

function sessionReading(readings: Reading[], late: string[], playerReadyTimeout = 60_000) {
  const evaluate = vi.fn(async () => readings.shift() ?? { arrived: [], waiting: [], broken: [] });
  const session = {
    page: { evaluate } as unknown as Page,
    lateImages: new Set(late),
    warnings: [],
    config: { playerReadyTimeout },
  } as unknown as CaptureSession;
  return { session, evaluate };
}

const PHOTO = "http://localhost:1/assets/photo.png";

describe("waitForShownLateImages", () => {
  it("never touches the page when no image was late", async () => {
    const { session, evaluate } = sessionReading([], []);
    await waitForShownLateImages(session, 0);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("waits for a late image the frame shows, then stops asking about it", async () => {
    const { session, evaluate } = sessionReading(
      [
        { arrived: [], waiting: [PHOTO], broken: [] },
        { arrived: [PHOTO], waiting: [], broken: [] },
      ],
      [PHOTO],
    );
    await waitForShownLateImages(session, 12);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(session.lateImages.size).toBe(0);
    await waitForShownLateImages(session, 13);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("captures on when the late image is not in this frame, and keeps it listed", async () => {
    const { session } = sessionReading([{ arrived: [], waiting: [], broken: [] }], [PHOTO]);
    await waitForShownLateImages(session, 0);
    expect([...session.lateImages]).toEqual([PHOTO]);
  });

  // fails without the fix: the frame was captured with the image missing and the render reported success.
  it("stops the render when a shown image has not arrived by the limit, naming frame and path", async () => {
    const { session } = sessionReading([{ arrived: [], waiting: [PHOTO], broken: [] }], [PHOTO], 0);
    const stopped = await waitForShownLateImages(session, 360).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(ImageMissingFromFrameError);
    expect(stopped).toMatchObject({ frameIndex: 360, sources: [PHOTO], failedToLoad: false });
    expect((stopped as Error).message).toContain("did not load in time");
    expect(session.warnings).toEqual([
      expect.objectContaining({
        code: "image_missing_from_frame",
        message: (stopped as Error).message,
      }),
    ]);
  });

  it("stops at once for a shown image that failed to load, since waiting cannot help", async () => {
    const { session, evaluate } = sessionReading(
      [{ arrived: [], waiting: [], broken: [PHOTO] }],
      [PHOTO],
    );
    const stopped = await waitForShownLateImages(session, 5).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(ImageMissingFromFrameError);
    expect((stopped as Error).message).toContain("failed to load");
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
