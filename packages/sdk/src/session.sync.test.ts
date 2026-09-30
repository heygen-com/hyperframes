import { describe, expect, it } from "vitest";
import { openComposition } from "./session.js";

const DRIFTED = `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="10">
  <video data-hf-id="hf-talk" src="talk.mp4" muted data-sync-origin="lk-1" data-start="2" data-duration="6" data-track-index="0"></video>
  <audio data-hf-id="hf-talk-audio" src="talk.mp4" data-sync-origin="lk-1" data-start="2.5" data-duration="6" data-media-start="0" data-track-index="1"></audio>
</div>
`.trim();

function attr(html: string, hfId: string, name: string): string | null {
  const tag = new RegExp(`<[^>]*data-hf-id="${hfId}"[^>]*>`).exec(html)?.[0] ?? "";
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

describe("sync origin on the SDK", () => {
  it("reports each half's signed offset in frames", async () => {
    const comp = await openComposition(DRIFTED);
    expect(comp.syncOffset("hf-talk-audio")).toBe(15);
    expect(comp.syncOffset("hf-talk", 24)).toBe(-12);
  });

  it("moveIntoSync moves that clip alone, and undo restores it", async () => {
    const comp = await openComposition(DRIFTED);
    comp.moveIntoSync("hf-talk-audio");
    expect(attr(comp.serialize(), "hf-talk-audio", "data-start")).toBe("2");
    expect(attr(comp.serialize(), "hf-talk", "data-start")).toBe("2");
    expect(comp.syncOffset("hf-talk-audio")).toBe(0);
    comp.undo();
    expect(attr(comp.serialize(), "hf-talk-audio", "data-start")).toBe("2.5");
  });

  it("slipIntoSync keeps the start and slips the media", async () => {
    const comp = await openComposition(DRIFTED);
    comp.slipIntoSync("hf-talk-audio");
    const html = comp.serialize();
    expect(attr(html, "hf-talk-audio", "data-start")).toBe("2.5");
    expect(attr(html, "hf-talk-audio", "data-media-start")).toBe("0.5");
    expect(comp.syncOffset("hf-talk-audio")).toBe(0);
  });

  it("refuses a slip that would start before the file", async () => {
    const comp = await openComposition(DRIFTED);
    expect(() => comp.slipIntoSync("hf-talk")).toThrow(/before its file/);
  });
});
