import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";
import { audioAttributeShapeError } from "./audioAttributes.js";

function composition(body: string, rootAttrs = ""): string {
  return `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080"${rootAttrs}>
    ${body}
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
}

async function findings(body: string, rootAttrs = "") {
  const result = await lintHyperframeHtml(composition(body, rootAttrs));
  return result.findings.filter((f) => f.code === "audio_attribute_unreadable");
}

const LANE = `{"target": "volume", "points": [{"t": 0, "v": 0}, {"t": 1, "v": 0.3}]}`;
const CUE = `id="bed" src="bed.mp3" data-start="0" data-duration="4" data-track-index="2"`;

describe("audio_attribute_unreadable", () => {
  it("flags a volume lane written without a version, which the render refuses", async () => {
    const found = await findings(`<audio ${CUE} data-automation='{"lanes": [${LANE}]}'></audio>`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", elementId: "bed" });
    expect(found[0]!.message).toContain("unsupported automation version: undefined");
    expect(found[0]!.fixHint).toContain('{"version": 1, "lanes": [...]}');
  });

  it("ignores an empty or valueless attribute, as the mixer does, but not a blank one it would parse", async () => {
    for (const attr of ["data-automation", "data-fx-chain"]) {
      expect(await findings(`<audio ${CUE} ${attr}=""></audio>`)).toEqual([]);
      expect(await findings(`<audio ${CUE} ${attr}></audio>`)).toEqual([]);
      expect(await findings(`<audio ${CUE} ${attr}="  "></audio>`)).toHaveLength(1);
    }
  });

  it("passes a well-formed lane and chain", async () => {
    const chain = `{"version": 1, "nodes": [{"type": "highpass", "id": "n1", "params": {"frequency": 70}}]}`;
    const body = `<audio ${CUE} data-automation='{"version": 1, "lanes": [${LANE}]}' data-fx-chain='${chain}'></audio>`;
    expect(await findings(body)).toEqual([]);
  });

  it("reads an entity-encoded chain and names the master bus when the root carries it", async () => {
    const found = await findings(
      "",
      ' data-fx-chain="{&quot;version&quot;: 2, &quot;nodes&quot;: []}"',
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe(
      "#root has a `data-fx-chain` the render cannot read: unsupported chain version: 2. The render fails on it, locally and in the cloud.",
    );
  });

  it.each([
    ["data-automation", "{version: 1}", /^it is not valid JSON/],
    ["data-automation", "[]", /^it is not a JSON object$/],
    ["data-automation", '{"version": 1}', /^it is missing a `lanes` array$/],
    [
      "data-automation",
      '{"version": 1, "lanes": [{"target": "volume"}]}',
      /^Lane 0 is missing a `points` array$/,
    ],
    ["data-automation", '{"version": 1, "lanes": [{"points": []}]}', /^Lane 0 has no `target`$/],
    ["data-fx-chain", '{"version": 1, "nodes": [7]}', /^Node 0 is not an object$/],
    ["data-fx-chain", '{"version": 1, "nodes": [{"id": "n1"}]}', /^Node 0 has no effect `type`$/],
  ] as const)("%s %s is refused", (attr, json, reason) => {
    expect(audioAttributeShapeError(attr, json)).toMatch(reason);
  });
});
