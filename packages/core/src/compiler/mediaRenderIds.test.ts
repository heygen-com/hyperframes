import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import {
  AUDIO_GROUP_RENDER_ID_ATTR,
  MEDIA_RENDER_ID_ATTR,
  assignMediaRenderIds,
} from "./mediaRenderIds";

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

  it("stamps empty-src media with colliding author ids", () => {
    // `src=""` used to skip the stamp. The snapshot then keyed by raw id and
    // colliding scenes collapsed. Runtime assignment is why the src is empty,
    // not a second path this function sees.
    const { document } = parseHTML(
      '<video id="clip" src=""></video><video id="clip" src=""></video>',
    );
    assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
    expect(
      Array.from(document.querySelectorAll("video")).map((el) =>
        el.getAttribute(MEDIA_RENDER_ID_ATTR),
      ),
    ).toEqual(["clip", "clip__hf2"]);
  });

  it("stamps a video with no source attribute at all", () => {
    const { document } = parseHTML('<video id="no-src"></video>');
    assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
    expect(document.querySelector("video")?.getAttribute(MEDIA_RENDER_ID_ATTR)).toBe("no-src");
  });

  it("stamps media whose source is a <source> child rather than a src attribute", () => {
    // The selector used to be `video[src], audio[src], img[src]`, so this shape
    // was never stamped and two inlined scenes kept colliding ids in the render
    // document, which is the exact failure this module exists to prevent.
    const { document } = parseHTML(
      '<video id="clip"><source src="a.mp4" type="video/mp4"></video>' +
        '<video id="clip"><source src="a.mp4" type="video/mp4"></video>',
    );
    assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
    expect(
      Array.from(document.querySelectorAll("video")).map((el) =>
        el.getAttribute(MEDIA_RENDER_ID_ATTR),
      ),
    ).toEqual(["clip", "clip__hf2"]);
  });

  it("stamps <audio> with a <source> child too", () => {
    const { document } = parseHTML('<audio id="bed"><source src="bed.mp3"></audio>');
    assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
    expect(document.querySelector("audio")?.getAttribute(MEDIA_RENDER_ID_ATTR)).toBe("bed");
  });

  it("stamps a video whose <source> child carries no src", () => {
    const { document } = parseHTML('<video id="empty"><source type="video/mp4"></video>');
    assignMediaRenderIds(document as unknown as Parameters<typeof assignMediaRenderIds>[0]);
    expect(document.querySelector("video")?.getAttribute(MEDIA_RENDER_ID_ATTR)).toBe("empty");
  });
});

describe("audio group render ids", () => {
  /**
   * A sub-composition declaring a bus AND its members, used twice. The author id
   * `bed` is unique per FILE and duplicated once inlined, and the two instances
   * are indistinguishable by `data-composition-id` — both carry the file's own —
   * so the subtree element is the only thing that separates them.
   */
  const doc = (html: string) => parseHTML(`<html><body>${html}</body></html>`).document;
  const TWICE = `
    <div data-composition-id="bedcomp">
      <hf-audio-group id="bed" data-volume="0.5"></hf-audio-group>
      <audio id="m1" src="a.wav" data-audio-group="bed"></audio>
    </div>
    <div data-composition-id="bedcomp">
      <hf-audio-group id="bed" data-volume="0.5"></hf-audio-group>
      <audio id="m1" src="a.wav" data-audio-group="bed"></audio>
    </div>`;

  it("gives each bus instance its own key and pairs each member to its own subtree", () => {
    const d = doc(TWICE);
    assignMediaRenderIds(d);

    const buses = [...d.querySelectorAll("hf-audio-group")];
    const members = [...d.querySelectorAll("audio")];
    expect(buses.map((b) => b.getAttribute(MEDIA_RENDER_ID_ATTR))).toEqual(["bed", "bed__hf2"]);
    // Member N belongs to bus N — the whole point. Cross-paired, one instance's
    // fader and chain would land on the other instance's audio.
    expect(members.map((m) => m.getAttribute(AUDIO_GROUP_RENDER_ID_ATTR))).toEqual([
      "bed",
      "bed__hf2",
    ]);
  });

  it("leaves a single-instance bus keyed by its own id", () => {
    const d = doc(`<hf-audio-group id="vo"></hf-audio-group>
      <audio id="a" src="a.wav" data-audio-group="vo"></audio>`);
    assignMediaRenderIds(d);
    expect(d.querySelector("hf-audio-group")?.getAttribute(MEDIA_RENDER_ID_ATTR)).toBe("vo");
    expect(d.querySelector("audio")?.getAttribute(AUDIO_GROUP_RENDER_ID_ATTR)).toBe("vo");
  });

  it("leaves a member alone when no bus element declares its group", () => {
    const d = doc(`<audio id="a" src="a.wav" data-audio-group="ghost"></audio>`);
    assignMediaRenderIds(d);
    // The element-less group is a supported shape; it just has no instance to
    // name, so resolution falls back to the author id as it always did.
    expect(d.querySelector("audio")?.hasAttribute(AUDIO_GROUP_RENDER_ID_ATTR)).toBe(false);
  });

  it("does not bind a root member to a same-named bus in a nested composition", () => {
    const d = doc(`<div data-composition-id="root">
      <div data-composition-id="child">
        <hf-audio-group id="bed"></hf-audio-group>
        <audio id="child-member" src="child.wav" data-audio-group="bed"></audio>
      </div>
      <audio id="root-member" src="root.wav" data-audio-group="bed"></audio>
      <hf-audio-group id="bed"></hf-audio-group>
    </div>`);
    assignMediaRenderIds(d);

    const buses = [...d.querySelectorAll("hf-audio-group")];
    expect(buses.map((bus) => bus.getAttribute(MEDIA_RENDER_ID_ATTR))).toEqual(["bed", "bed__hf2"]);
    expect(d.getElementById("child-member")?.getAttribute(AUDIO_GROUP_RENDER_ID_ATTR)).toBe("bed");
    expect(d.getElementById("root-member")?.getAttribute(AUDIO_GROUP_RENDER_ID_ATTR)).toBe(
      "bed__hf2",
    );
  });
});
