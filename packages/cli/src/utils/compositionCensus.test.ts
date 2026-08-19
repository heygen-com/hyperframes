import { describe, expect, it } from "vitest";

import { buildCompositionCensus, renderCompositionCensusBlock } from "./compositionCensus.js";

const MINIMAL_HTML = `<!doctype html>
<html>
  <body>
    <div data-composition-id="main" data-start="0" data-duration="5"></div>
  </body>
</html>`;

const RICH_HTML = `<!doctype html>
<html>
  <head>
    <style>
      .card { filter: blur(4px); mix-blend-mode: multiply; }
      .fixed-bar { position: fixed; overflow: hidden; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  </head>
  <body>
    <div data-composition-id="main" data-start="0" data-duration="10">
      <video data-has-audio="true"></video>
      <video></video>
      <audio></audio>
      <img />
      <img />
      <img />
      <svg></svg>
      <canvas></canvas>
      <div data-composition-src="scenes/intro.html" data-start="0"></div>
      <div data-composition-src="scenes/outro.html" data-start="5"></div>
      <div style="clip-path: circle(50%); transform: translateX(10px); z-index: 3"></div>
      <div style="background-image: url('bg.png')"></div>
      <div style="mask-image: url('mask.svg')"></div>
    </div>
    <script>
      gsap.timeline().to(".card", { x: 100 });
    </script>
  </body>
</html>`;

describe("buildCompositionCensus", () => {
  it("counts zero media on a minimal composition", () => {
    const c = buildCompositionCensus(MINIMAL_HTML);
    expect(c.elementCensus).toEqual({
      video: 0,
      audio: 0,
      img: 0,
      svg: 0,
      canvas: 0,
      subCompositionMounts: 0,
    });
    expect(c.timelineShape.nested).toBe(false);
    expect(c.timelineShape.subCompositionCount).toBe(0);
    expect(c.timelineShape.usesGsap).toBe(false);
    expect(c.timelineShape.usesDataTimeline).toBe(true);
  });

  it("counts each element category on a rich composition", () => {
    const c = buildCompositionCensus(RICH_HTML);
    expect(c.elementCensus).toEqual({
      video: 2,
      audio: 1,
      img: 3,
      svg: 1,
      canvas: 1,
      subCompositionMounts: 2,
    });
  });

  it("detects structural attributes from both inline style and <style> rules", () => {
    const c = buildCompositionCensus(RICH_HTML);
    // Inline-style probes
    expect(c.structuralAttributes.clipPath).toBe(true);
    expect(c.structuralAttributes.transform).toBe(true);
    expect(c.structuralAttributes.zIndex).toBe(true);
    expect(c.structuralAttributes.backgroundImage).toBe(true);
    expect(c.structuralAttributes.maskImage).toBe(true);
    // <style> tag probes
    expect(c.structuralAttributes.filter).toBe(true);
    expect(c.structuralAttributes.mixBlendMode).toBe(true);
    expect(c.structuralAttributes.positionFixed).toBe(true);
    expect(c.structuralAttributes.overflowHidden).toBe(true);
    // data-* attribute probes
    expect(c.structuralAttributes.dataHasAudio).toBe(true);
    expect(c.structuralAttributes.dataDuration).toBe(true);
    expect(c.structuralAttributes.dataStart).toBe(true);
    expect(c.structuralAttributes.dataCompositionSrc).toBe(true);
  });

  it("reports absent attributes as false on minimal HTML", () => {
    const c = buildCompositionCensus(MINIMAL_HTML);
    expect(c.structuralAttributes.clipPath).toBe(false);
    expect(c.structuralAttributes.filter).toBe(false);
    expect(c.structuralAttributes.mixBlendMode).toBe(false);
    expect(c.structuralAttributes.dataHasAudio).toBe(false);
    expect(c.structuralAttributes.backgroundImage).toBe(false);
    expect(c.structuralAttributes.maskImage).toBe(false);
  });

  it("detects gsap from both script src and inline gsap.* calls", () => {
    expect(buildCompositionCensus(RICH_HTML).timelineShape.usesGsap).toBe(true);
    const inlineOnly = `<html><body><div data-composition-id="m"></div><script>gsap.to('.x', {})</script></body></html>`;
    expect(buildCompositionCensus(inlineOnly).timelineShape.usesGsap).toBe(true);
    const noGsap = `<html><body><div data-composition-id="m"></div><script>console.log('hi')</script></body></html>`;
    expect(buildCompositionCensus(noGsap).timelineShape.usesGsap).toBe(false);
  });

  it("marks timelines as nested when sub-comp mounts exist", () => {
    const c = buildCompositionCensus(RICH_HTML);
    expect(c.timelineShape.nested).toBe(true);
    expect(c.timelineShape.subCompositionCount).toBe(2);
  });

  describe("value-scoped structural probes", () => {
    it("positionFixed is false for inline position:absolute (name-vs-value scope)", () => {
      const html = `<html><body><div data-composition-id="m" style="position: absolute"></div></body></html>`;
      const c = buildCompositionCensus(html);
      expect(c.structuralAttributes.positionFixed).toBe(false);
    });

    it("positionFixed is true for inline position:fixed", () => {
      const html = `<html><body><div data-composition-id="m" style="position: fixed"></div></body></html>`;
      const c = buildCompositionCensus(html);
      expect(c.structuralAttributes.positionFixed).toBe(true);
    });

    it("overflowHidden catches inline overflow:hidden (symmetric with style-tag path)", () => {
      const html = `<html><body><div data-composition-id="m" style="overflow: hidden"></div></body></html>`;
      const c = buildCompositionCensus(html);
      expect(c.structuralAttributes.overflowHidden).toBe(true);
    });

    it("overflowHidden is false for inline overflow:visible", () => {
      const html = `<html><body><div data-composition-id="m" style="overflow: visible"></div></body></html>`;
      const c = buildCompositionCensus(html);
      expect(c.structuralAttributes.overflowHidden).toBe(false);
    });

    it("backgroundImage catches the inline shorthand `background: url(...)`", () => {
      const html = `<html><body><div data-composition-id="m" style="background: url('bg.png') center"></div></body></html>`;
      const c = buildCompositionCensus(html);
      expect(c.structuralAttributes.backgroundImage).toBe(true);
    });

    it("maskImage catches the inline shorthand `mask: url(...)`", () => {
      const html = `<html><body><div data-composition-id="m" style="mask: url('mask.svg')"></div></body></html>`;
      const c = buildCompositionCensus(html);
      expect(c.structuralAttributes.maskImage).toBe(true);
    });

    it("does not count `inherit` / `revert` as authored intent", () => {
      const html = `<html><body><div data-composition-id="m" style="position: inherit; filter: revert"></div></body></html>`;
      const c = buildCompositionCensus(html);
      expect(c.structuralAttributes.positionFixed).toBe(false);
      expect(c.structuralAttributes.filter).toBe(false);
    });
  });

  it("short-circuits on HTML over the size cap without throwing", () => {
    const huge = "a".repeat(21 * 1024 * 1024);
    const c = buildCompositionCensus(huge);
    // Guard-rail returns a zero census — no OOM, no crash.
    expect(c.elementCensus.video).toBe(0);
    expect(c.timelineShape.subCompositionCount).toBe(0);
    expect(c.structuralAttributes.positionFixed).toBe(false);
  });
});

describe("renderCompositionCensusBlock", () => {
  it("emits a REPRO-packet-compatible block starting with the mandated header", () => {
    const block = renderCompositionCensusBlock(buildCompositionCensus(RICH_HTML));
    expect(block.startsWith("COMPOSITION_STRUCTURE:")).toBe(true);
    expect(block).toContain("elements: video=2 audio=1 img=3 svg=1 canvas=1 subComps=2");
    expect(block).toContain("attributes:");
    expect(block).toContain("timeline: nested (2 sub-comps); driver=gsap+data-timeline");
    // Placeholder slots the parser can't infer.
    expect(block).toContain("delta:");
    expect(block).toContain("defect:");
  });

  it("emits '(none present)' on the attributes line when no structural attrs are found", () => {
    const empty = `<html><body><div data-composition-id="m"></div></body></html>`;
    const block = renderCompositionCensusBlock(buildCompositionCensus(empty));
    expect(block).toContain("attributes: (none present)");
    expect(block).toContain("timeline: flat; driver=none");
  });
});
