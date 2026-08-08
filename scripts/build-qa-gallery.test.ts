import { describe, expect, test } from "bun:test";

import { buildKnobs, parseCoverageMap, planLocalAssets, renderGallery } from "./build-qa-gallery";

const coverage = `
| candidate | job | mechanic | status (EXISTS/PARTIAL/BUILT/GAP) | registry path or note |
|---|---|---|---|---|
| \`live-one\` | demonstrate | Works. | **EXISTS** | \`components/live-one/\` - **contract-shaped**; complete. |
| \`built-one\` | prove | Newly built. | **BUILT** | \`components/built-one/\` |
| \`near-one\` | emphasize | Nearly works. | **PARTIAL** | \`components/near-one/\` - has the reveal, but lacks the final settle. |
| \`gap-one\` | bridge | Missing. | **GAP** | No implementation exists. |
`;

describe("QA gallery driver", () => {
  test("parses coverage, normalizes knobs, and renders honest grouped cards", () => {
    const candidates = parseCoverageMap(coverage);

    expect(candidates).toEqual([
      {
        candidate: "live-one",
        job: "demonstrate",
        status: "EXISTS",
        registryPath: "components/live-one/",
        note: "complete.",
      },
      {
        candidate: "built-one",
        job: "prove",
        status: "BUILT",
        registryPath: "components/built-one/",
        note: "",
      },
      {
        candidate: "near-one",
        job: "emphasize",
        status: "PARTIAL",
        registryPath: "components/near-one/",
        note: "lacks the final settle.",
      },
      {
        candidate: "gap-one",
        job: "bridge",
        status: "GAP",
        registryPath: undefined,
        note: "No implementation exists.",
      },
    ]);

    expect(
      buildKnobs([
        {
          id: "mode",
          type: "enum",
          default: "tap",
          options: [{ value: "tap" }, { value: "swipe" }],
        },
        { id: "strength", type: "number", default: 2 },
        { id: "label", type: "string", default: "Go" },
      ]),
    ).toEqual([
      { name: "mode", value: "tap", options: ["tap", "swipe"] },
      { name: "strength", value: 2 },
      { name: "label", value: "Go" },
    ]);

    const html = renderGallery(
      candidates,
      new Map([
        ["live-one", []],
        ["built-one", []],
        ["near-one", []],
      ]),
    );
    expect(html).toContain('data-src="/public/qa/live-one.html"');
    expect(html).toContain("built-one - prove - BUILT");
    expect(html).toContain("near-one - emphasize - PARTIAL - differs: lacks the final settle.");
    expect(html).toContain("gap-one - bridge - GAP (to build)");
    expect(html).toContain('<script src="/hyperframes-player.global.js"></script>');
    expect(html).toContain('<script src="/hyperframes-player-embed.js"></script>');
    expect(html).toContain('<script src="/qa-autoplay.js"></script>');
    expect(html).not.toContain("\u2014");
  });

  test("relocates local assets while leaving URLs and fragments unchanged", () => {
    const staged = planLocalAssets(
      '<script src="../../vendor/gsap.js"></script><audio src="assets/click.wav"></audio><use href="#shape"></use><script src="https://example.com/live.js"></script>',
      "live-one",
    );

    expect(staged).toEqual({
      html: '<script src="./live-one-assets/0-gsap.js"></script><audio src="./live-one-assets/1-click.wav"></audio><use href="#shape"></use><script src="https://example.com/live.js"></script>',
      assets: [
        { source: "../../vendor/gsap.js", target: "live-one-assets/0-gsap.js" },
        { source: "assets/click.wav", target: "live-one-assets/1-click.wav" },
      ],
    });
  });
});
