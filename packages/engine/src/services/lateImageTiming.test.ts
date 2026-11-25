import { describe, expect, it } from "vitest";
import { describeLateImage, type RawResourceTiming } from "./lateImageTiming.js";

const PAGE = "http://localhost:42957";
// Waited 40 s for a connection slot on a reused connection, then answered at once.
const QUEUED: RawResourceTiming = {
  startTime: 1_500,
  fetchStart: 1_500,
  connectStart: 1_500,
  connectEnd: 1_500,
  requestStart: 41_500,
  responseStart: 41_510,
  responseEnd: 41_512,
};

describe("describeLateImage", () => {
  it("splits a late image's load into queued, connect, first byte and download", () => {
    expect(describeLateImage(`${PAGE}/assets/logo.svg`, PAGE, QUEUED)).toEqual({
      from: "page-server",
      pathDepth: 2,
      extension: "svg",
      timing: {
        requestedAtMs: 1_500,
        totalMs: 40_012,
        queuedMs: 40_000,
        connectMs: 0,
        firstByteMs: 10,
        downloadMs: 2,
      },
    });
  });

  // fails without the fix: a host the browser loads but Node's URL parser rejects threw out of the late-image wait
  it("describes an image whose URL Node cannot parse as another origin, without throwing", () => {
    const src = "https://xn--ab-m1t.com/assets/logo.png";
    expect(() => new URL(src)).toThrow();
    expect(describeLateImage(src, PAGE, QUEUED)).toMatchObject({
      from: "other-origin",
      pathDepth: 0,
      extension: "",
    });
  });

  it("counts a new connection as connect time, not queue time", () => {
    const fresh = { ...QUEUED, connectStart: 1_600, connectEnd: 1_900, requestStart: 1_900 };
    const record = describeLateImage(`${PAGE}/assets/logo.svg`, PAGE, fresh);
    expect(record.timing).toMatchObject({ queuedMs: 100, connectMs: 300 });
  });

  it("keeps no host, query or file name from the URL", () => {
    const src = "https://cdn.customer-brand.example/team/acme-secret-logo.PNG?token=abc";
    const record = describeLateImage(src, PAGE, QUEUED);
    expect(record).toMatchObject({ from: "other-origin", pathDepth: 2, extension: "png" });
    expect(JSON.stringify(record)).not.toMatch(/customer-brand|acme|secret|token|team/);
  });

  // fails without the fix: the zeroed fields made a slow server read as a slow download.
  it("reports only the total for another origin that hides its request timing", () => {
    // What Chrome records for another origin without Timing-Allow-Origin.
    const hidden = { ...QUEUED, connectStart: 0, connectEnd: 0, requestStart: 0, responseStart: 0 };
    const record = describeLateImage("https://cdn.example/a/b.png", PAGE, hidden);
    expect(record.timing).toEqual({ requestedAtMs: 1_500, totalMs: 40_012, split: "not-exposed" });
  });

  it("says so when the page kept no timing entry for the image", () => {
    expect(describeLateImage(`${PAGE}/a.svg`, PAGE, undefined).timing).toBe("no-entry");
  });
});
