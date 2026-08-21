import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { MEDIA_RENDER_ID_ATTR, assignMediaRenderIds } from "./mediaRenderIds";

function stamp(html: string): string[] {
  const { document } = parseHTML(html);
  assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
  return Array.from(document.querySelectorAll("video, audio, img")).map(
    (el) => el.getAttribute(MEDIA_RENDER_ID_ATTR) ?? "",
  );
}

describe("assignMediaRenderIds", () => {
  it("keeps the element id when it is already unique", () => {
    expect(stamp('<video id="hero" src="a.mp4">')).toEqual(["hero"]);
  });

  it("disambiguates a media id shared by two inlined compositions", () => {
    // Two scenes each authored `<video id="clip">`: legal per file, duplicated
    // once both are inlined into one render document.
    expect(stamp('<video id="clip" src="a.mp4"><video id="clip" src="a.mp4">')).toEqual([
      "clip",
      "clip__hf2",
    ]);
  });

  it("disambiguates per-file auto-ids, which collide without any authored id", () => {
    // The timing compiler numbers unnamed media per file, so two bare <video>s
    // in two scenes both arrive as `hf-video-0`.
    expect(stamp('<video id="hf-video-0" src="a.mp4"><video id="hf-video-0" src="b.mp4">')).toEqual(
      ["hf-video-0", "hf-video-0__hf2"],
    );
  });

  it("keeps disambiguating past the first collision", () => {
    const html = '<video id="c" src="a.mp4"><video id="c" src="a.mp4"><video id="c" src="a.mp4">';
    expect(stamp(html)).toEqual(["c", "c__hf2", "c__hf3"]);
  });

  it("separates ids across tag types", () => {
    expect(
      stamp('<video id="m" src="a.mp4"><audio id="m" src="a.mp3"><img id="m" src="a.png">'),
    ).toEqual(["m", "m__hf2", "m__hf3"]);
  });

  it("does not renumber elements that already carry a render id", () => {
    const { document } = parseHTML(
      `<video id="clip" ${MEDIA_RENDER_ID_ATTR}="clip" src="a.mp4">` +
        `<video id="clip" ${MEDIA_RENDER_ID_ATTR}="clip__hf2" src="a.mp4">`,
    );
    assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
    expect(
      Array.from(document.querySelectorAll("video")).map((el) =>
        el.getAttribute(MEDIA_RENDER_ID_ATTR),
      ),
    ).toEqual(["clip", "clip__hf2"]);
  });

  it("does not claim an id that a later element already holds as its render id", () => {
    // Re-running over a partially stamped document must not hand `clip__hf2`
    // to the first element and collide with the element already holding it.
    const { document } = parseHTML(
      `<video id="clip__hf2" src="a.mp4">` +
        `<video id="clip" ${MEDIA_RENDER_ID_ATTR}="clip__hf2" src="a.mp4">`,
    );
    assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
    const ids = Array.from(document.querySelectorAll("video")).map((el) =>
      el.getAttribute(MEDIA_RENDER_ID_ATTR),
    );
    expect(new Set(ids).size).toBe(2);
    expect(ids[1]).toBe("clip__hf2");
  });

  it("leaves media without a src alone", () => {
    const { document } = parseHTML('<video id="no-src"></video>');
    assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
    expect(document.querySelector("video")?.hasAttribute(MEDIA_RENDER_ID_ATTR)).toBe(false);
  });
});
