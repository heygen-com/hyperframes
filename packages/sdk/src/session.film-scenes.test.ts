import { describe, expect, it } from "vitest";
import { openComposition } from "./session.js";

const SOURCE = "const originalScene = (t) => ({ x: 200 * t });";
const LOAD = JSON.stringify({
  script: SOURCE,
  modules: [],
  assets: [],
  sourceRange: { start: 3, duration: 4, fps: 60 },
});
const HTML = `<!doctype html><html><head></head><body>
<div data-hf-id="hf-root" data-hf-root data-composition-id="main" data-width="1920" data-height="1080" data-duration="14">
  <div class="clip" data-hf-id="hf-boat" data-composition-id="boat" data-start="3" data-duration="4" data-track-index="0" data-playback-start="0">
    <iframe sandbox="allow-scripts" title="Boat scene"></iframe>
  </div>
  <script id="film-source" type="application/json">${LOAD}</script>
</div></body></html>`;

function timing(html: string) {
  const tag = /<div[^>]*data-hf-id="hf-boat"[^>]*>/.exec(html)?.[0] ?? "";
  const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
  return {
    start: attr("data-start"),
    duration: attr("data-duration"),
    inpoint: attr("data-playback-start"),
    rate: attr("data-playback-rate"),
    track: attr("data-track-index"),
  };
}

function expectPreserved(html: string) {
  expect(html).toContain(LOAD);
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).not.toContain("allow-same-origin");
  expect(html).not.toContain("gsap.timeline");
}

describe("preserved film scene editing", () => {
  it("moves and resizes a no-GSAP scene without rewriting its source", async () => {
    const comp = await openComposition(HTML);
    comp.setTiming("hf-boat", { start: 7, duration: 6, trackIndex: 2 });
    const exported = comp.serialize();
    expect(timing(exported)).toMatchObject({ start: "7", duration: "6", track: "2" });
    expectPreserved(exported);
    const reopened = await openComposition(exported);
    expect(timing(reopened.serialize())).toEqual(timing(exported));
    expectPreserved(reopened.serialize());
  });

  it("persists an independent source inpoint and rate across save/reopen", async () => {
    const comp = await openComposition(HTML);
    comp.setAttribute("hf-boat", "data-playback-start", "0.5");
    comp.setAttribute("hf-boat", "data-playback-rate", "2");
    comp.setTiming("hf-boat", { start: 0, duration: 1.5 });
    const reopened = await openComposition(comp.serialize());
    expect(timing(reopened.serialize())).toMatchObject({
      start: "0",
      duration: "1.5",
      inpoint: "0.5",
      rate: "2",
    });
    expectPreserved(reopened.serialize());
  });

  it("undoes and redoes timing edits while retaining the original scene payload", async () => {
    const comp = await openComposition(HTML);
    comp.setTiming("hf-boat", { start: 0, duration: 8 });
    comp.undo();
    expect(timing(comp.serialize())).toMatchObject({ start: "3", duration: "4" });
    expectPreserved(comp.serialize());
    comp.redo();
    expect(timing(comp.serialize())).toMatchObject({ start: "0", duration: "8" });
    expectPreserved(comp.serialize());
  });
});
