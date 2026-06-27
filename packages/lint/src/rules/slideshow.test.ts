import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

async function findSlideshow(html: string) {
  const result = await lintHyperframeHtml(html, { isSubComposition: true });
  return result.findings.filter((f) => f.code.startsWith("slideshow_"));
}

describe("slideshow lint rule", () => {
  it("passes a composition with no slideshow island", async () => {
    const html = `<div data-composition-id="c" data-width="1920" data-height="1080">
      <div id="a" class="clip" data-start="0" data-duration="5"></div>
    </div>`;
    expect(await findSlideshow(html)).toEqual([]);
  });

  it("passes a valid island where sceneId resolves to a data-composition-id scene", async () => {
    const html = `<div data-composition-id="c" data-width="1920" data-height="1080">
      <div data-composition-id="a" data-start="0" data-duration="5"></div>
      <script type="application/hyperframes-slideshow+json">{"slides":[{"sceneId":"a"}]}</script>
    </div>`;
    expect(await findSlideshow(html)).toEqual([]);
  });

  it("flags a sceneId that matches only a .clip[id] (not a data-composition-id)", async () => {
    const html = `<div data-composition-id="c" data-width="1920" data-height="1080">
      <div id="a" class="clip" data-start="0" data-duration="5"></div>
      <script type="application/hyperframes-slideshow+json">{"slides":[{"sceneId":"a"}]}</script>
    </div>`;
    const findings = await findSlideshow(html);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.message).toContain("a");
  });

  it("flags an unresolved sceneId", async () => {
    const html = `<div data-composition-id="c" data-width="1920" data-height="1080">
      <div id="a" class="clip" data-start="0" data-duration="5"></div>
      <script type="application/hyperframes-slideshow+json">{"slides":[{"sceneId":"ghost"}]}</script>
    </div>`;
    const findings = await findSlideshow(html);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toContain("ghost");
  });

  it("flags invalid JSON in the island", async () => {
    const html = `<div data-composition-id="c" data-width="1920" data-height="1080">
      <script type="application/hyperframes-slideshow+json">NOT_JSON</script>
    </div>`;
    const findings = await findSlideshow(html);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.code).toBe("slideshow_invalid");
  });

  it("passes when sceneId resolves to a data-composition-id element (no .clip[id])", async () => {
    const html = `<div data-composition-id="c" data-width="1920" data-height="1080">
      <div data-composition-id="scene-a" data-start="0" data-duration="5"></div>
      <script type="application/hyperframes-slideshow+json">{"slides":[{"sceneId":"scene-a"}]}</script>
    </div>`;
    expect(await findSlideshow(html)).toEqual([]);
  });

  it("flags a hotspot targeting an unknown sequence", async () => {
    const html = `<div data-composition-id="c" data-width="1920" data-height="1080">
      <div data-composition-id="a" data-start="0" data-duration="5"></div>
      <script type="application/hyperframes-slideshow+json">${JSON.stringify({
        slides: [{ sceneId: "a", hotspots: [{ id: "h1", label: "Go", target: "no-such-seq" }] }],
      })}</script>
    </div>`;
    const findings = await findSlideshow(html);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toContain("no-such-seq");
  });
});
