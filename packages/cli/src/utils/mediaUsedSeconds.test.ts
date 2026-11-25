import { describe, expect, it } from "vitest";
import { mediaUsedSeconds } from "./mediaUsedSeconds.js";

const page = (body: string): string => `<html><body>${body}</body></html>`;

describe("mediaUsedSeconds", () => {
  it("reads the stretch a timed video plays, from its media offset", () => {
    const html = page(
      '<video src="assets/a.mov" data-start="0" data-duration="5" data-media-start="10"></video>',
    );
    expect(mediaUsedSeconds(html).get("/assets/a.mov")).toBe(15);
  });

  it("takes the longest of several clips of one file, whatever the src spelling", () => {
    const html = page(
      '<video src="./a.mov?x=1" data-duration="4"></video><video src="/a.mov" data-duration="9"></video>',
    );
    expect(mediaUsedSeconds(html).get("/a.mov")).toBe(9);
  });

  it("reads an untimed video's stretch from the wrapper that times it", () => {
    const html = page('<div data-start="2" data-duration="6"><video src="a.mov"></video></div>');
    expect(mediaUsedSeconds(html).get("/a.mov")).toBe(6);
  });

  it("rounds a slower rate up, not down", () => {
    const html = page(
      '<video src="a.mov" data-duration="5" data-playback-rate="0.5"></video><video src="b.mov" data-duration="5" data-playback-rate="2"></video>',
    );
    const used = mediaUsedSeconds(html);
    expect([used.get("/a.mov"), used.get("/b.mov")]).toEqual([5, 10]);
  });

  it("leaves a file out, to be copied whole, when any use of it is not a known stretch", () => {
    const html = page(
      [
        '<video src="loop.mov" data-duration="5" loop></video>',
        '<video src="untimed.mov"></video>',
        '<video src="mixed.mov" data-duration="5"></video><img src="mixed.mov">',
        '<video data-duration="5"><source src="inner.mov"></video>',
      ].join(""),
    );
    expect([...mediaUsedSeconds(html).keys()]).toEqual([]);
  });
});
