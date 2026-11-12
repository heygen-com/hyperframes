import { describe, expect, it } from "vitest";
import { corsProjectVideos } from "./captureVideos.js";

const doc = (body: string) => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;

describe("corsProjectVideos", () => {
  it("loads the project's own videos with CORS and leaves the rest alone", () => {
    const html = corsProjectVideos(
      doc(
        '<video id="a" src="assets/a.mp4"></video>' +
          '<video id="b" src="/api/projects/p/preview/b.mp4"></video>' +
          '<video id="c"><source src="c.mp4"></video>' +
          '<video id="d" src="https://cdn.example/d.mp4"></video>' +
          '<video id="e" src="//cdn.example/e.mp4"></video>' +
          '<video id="f" src="blob:x"></video>' +
          '<video id="g" crossorigin="use-credentials" src="g.mp4"></video>' +
          '<video id="h"><source src="h.webm"><source src="https://cdn.example/h.mp4"></video>',
      ),
    );
    const marked = [...html.matchAll(/<video crossorigin="anonymous" id="(\w)"/g)].map((m) => m[1]);
    expect(marked).toEqual(["a", "b", "c"]);
    expect(html).toContain('<video id="g" crossorigin="use-credentials"');
  });

  it("returns a document without videos unchanged", () => {
    const html = doc('<img src="a.png">');
    expect(corsProjectVideos(html)).toBe(html);
  });
});
