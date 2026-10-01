import { describe, expect, it } from "vitest";
import { openComposition } from "./session.js";

const LINKED_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="10">
  <video data-hf-id="hf-talk" src="talk.mp4" muted data-link="lk-1" data-start="2" data-duration="6" data-track-index="0"></video>
  <audio data-hf-id="hf-talk-audio" src="talk.mp4" data-link="lk-1" data-start="2" data-duration="6" data-track-index="2"></audio>
  <audio data-hf-id="hf-music" src="bgm.mp3" data-start="0" data-duration="10" data-track-index="3"></audio>
</div>
`.trim();

function attr(html: string, hfId: string, name: string): string | null {
  const tag = new RegExp(`<[^>]*data-hf-id="${hfId}"[^>]*>`).exec(html)?.[0] ?? "";
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

describe("setTiming on linked clips", () => {
  it("moves link partners by default, each keeping its own track", async () => {
    const comp = await openComposition(LINKED_HTML);
    comp.setTiming("hf-talk", { start: 3, trackIndex: 1 });
    const html = comp.serialize();
    expect(attr(html, "hf-talk", "data-start")).toBe("3");
    expect(attr(html, "hf-talk-audio", "data-start")).toBe("3");
    expect(attr(html, "hf-talk", "data-track-index")).toBe("1");
    expect(attr(html, "hf-talk-audio", "data-track-index")).toBe("2");
    expect(attr(html, "hf-music", "data-start")).toBe("0");
  });

  it("trims partners to the same duration, and one undo reverts both", async () => {
    const comp = await openComposition(LINKED_HTML);
    comp.setTiming("hf-talk-audio", { duration: 4 });
    expect(attr(comp.serialize(), "hf-talk", "data-duration")).toBe("4");
    comp.undo();
    const html = comp.serialize();
    expect(attr(html, "hf-talk", "data-duration")).toBe("6");
    expect(attr(html, "hf-talk-audio", "data-duration")).toBe("6");
  });

  it("{ linked: false } edits one member and unlinks the pair", async () => {
    const comp = await openComposition(LINKED_HTML);
    comp.setTiming("hf-talk", { start: 5 }, { linked: false });
    const html = comp.serialize();
    expect(attr(html, "hf-talk", "data-start")).toBe("5");
    expect(attr(html, "hf-talk-audio", "data-start")).toBe("2");
    expect(attr(html, "hf-talk", "data-link")).toBeNull();
    expect(attr(html, "hf-talk-audio", "data-link")).toBeNull();
    comp.undo();
    expect(attr(comp.serialize(), "hf-talk", "data-link")).toBe("lk-1");
  });

  it("a batch naming both members stays in sync", async () => {
    const comp = await openComposition(LINKED_HTML);
    comp.setElementTiming({ "hf-talk": { start: 4 }, "hf-talk-audio": { start: 4 } });
    const html = comp.serialize();
    expect(attr(html, "hf-talk", "data-start")).toBe("4");
    expect(attr(html, "hf-talk-audio", "data-start")).toBe("4");
  });

  it.each([
    'data-composition-id="child" data-composition-file="child.html"',
    'data-composition-file="child.html"',
  ])("keeps a link group inside its own composition (host %s)", async (host) => {
    const comp = await openComposition(
      `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="10">
  <video data-hf-id="hf-v" src="talk.mp4" muted data-link="lk-1" data-start="0" data-duration="4" data-track-index="0"></video>
  <audio data-hf-id="hf-a" src="talk.mp4" data-link="lk-1" data-start="0" data-duration="4" data-track-index="1"></audio>
  <div data-hf-id="hf-host" ${host} data-start="0" data-duration="10" data-track-index="2">
    <video data-hf-id="hf-cv" src="b.mp4" muted data-link="lk-1" data-start="0" data-duration="4" data-track-index="0"></video>
    <audio data-hf-id="hf-ca" src="b.mp4" data-link="lk-1" data-start="0" data-duration="4" data-track-index="1"></audio>
  </div>
</div>`.trim(),
    );
    comp.setTiming("hf-v", { start: 2 });
    let html = comp.serialize();
    expect(attr(html, "hf-a", "data-start")).toBe("2");
    expect(attr(html, "hf-cv", "data-start")).toBe("0");
    expect(attr(html, "hf-ca", "data-start")).toBe("0");
    comp.setTiming("hf-host/hf-cv", { start: 1 });
    html = comp.serialize();
    expect(attr(html, "hf-ca", "data-start")).toBe("1");
    expect(attr(html, "hf-v", "data-start")).toBe("2");
    expect(attr(html, "hf-a", "data-start")).toBe("2");
  });

  it("keeps a link group inside an inline composition that reuses the id", async () => {
    const comp = await openComposition(
      `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="10">
  <video data-hf-id="hf-v" src="talk.mp4" muted data-link="lk-1" data-start="0" data-duration="4" data-track-index="0"></video>
  <audio data-hf-id="hf-a" src="talk.mp4" data-link="lk-1" data-start="0" data-duration="4" data-track-index="1"></audio>
  <div data-hf-id="hf-child" data-composition-id="child" data-start="0" data-duration="10" data-track-index="2">
    <video data-hf-id="hf-cv" src="b.mp4" muted data-link="lk-1" data-start="5" data-duration="4" data-track-index="0"></video>
    <audio data-hf-id="hf-ca" src="b.mp4" data-link="lk-1" data-start="5" data-duration="4" data-track-index="1"></audio>
  </div>
</div>`.trim(),
    );
    comp.setTiming("hf-v", { start: 2 });
    let html = comp.serialize();
    expect(attr(html, "hf-a", "data-start")).toBe("2");
    expect(attr(html, "hf-cv", "data-start")).toBe("5");
    expect(attr(html, "hf-ca", "data-start")).toBe("5");
    comp.setTiming("hf-cv", { start: 6 });
    html = comp.serialize();
    expect(attr(html, "hf-ca", "data-start")).toBe("6");
    expect(attr(html, "hf-v", "data-start")).toBe("2");
    comp.setTiming("hf-ca", { start: 7 }, { linked: false });
    html = comp.serialize();
    expect(attr(html, "hf-cv", "data-link")).toBeNull();
    expect(attr(html, "hf-v", "data-link")).toBe("lk-1");
    expect(attr(html, "hf-a", "data-link")).toBe("lk-1");
  });
});
