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
});
