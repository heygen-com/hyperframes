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
        queuedMs: 40_000,
        connectMs: 0,
        firstByteMs: 10,
        downloadMs: 2,
      },
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

  it("says so when the page kept no timing entry for the image", () => {
    expect(describeLateImage(`${PAGE}/a.svg`, PAGE, undefined).timing).toBe("no-entry");
  });
});
