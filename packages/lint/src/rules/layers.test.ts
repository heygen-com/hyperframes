import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

const CODE = "three_d_layer_far_larger_than_stage";

function html(body: string, style = ""): string {
  return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    ${body}
  </div>
  <style>${style}</style>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

const floor = (w: number, h: number) =>
  `#floor{position:absolute;width:${w}px;height:${h}px;transform:translateZ(-1800px) rotateX(90deg)}`;

async function hits(source: string) {
  return (await lintHyperframeHtml(source)).findings.filter((f) => f.code === CODE);
}

describe("three_d_layer_far_larger_than_stage", () => {
  it("warns on an 11000x5200 rotateX floor in a 1920x1080 composition", async () => {
    const found = await hits(html('<div id="floor"></div>', floor(11000, 5200)));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", selector: "#floor" });
    expect(found[0]!.message).toContain("11000x5200px");
    expect(found[0]!.message).toContain("28x the 1920x1080 stage");
  });

  it("is quiet for the same floor at stage size", async () => {
    expect(await hits(html('<div id="floor"></div>', floor(1920, 1080)))).toEqual([]);
  });

  it("is quiet for a large element without a 3D transform", async () => {
    const css = "#bg{width:11000px;height:5200px;transform:translateX(-50%) rotate(10deg)}";
    expect(await hits(html('<div id="bg"></div>', css))).toEqual([]);
  });

  it("warns on an inline style", async () => {
    const tag = '<div id="wall" style="width:9000px;height:9000px;transform:rotateY(40deg)"></div>';
    const found = await hits(html(tag));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ elementId: "wall" });
  });
});
