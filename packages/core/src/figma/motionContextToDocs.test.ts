// @vitest-environment node
import { describe, expect, it } from "vitest";
import { motionContextToDocs } from "./motionContextToDocs";
import type { MotionContextResponse } from "./motionContextToDocs";

/**
 * Fixture: verbatim `get_motion_context` response for the SDS "Unlocked"
 * Motion card (fileKey Hl5L3gkQ3Tz3Y2KTQJbAkT, node 3021:6485, 2026-07-08).
 * The expected outputs were validated frame-by-frame against Figma's own
 * `export_video` render of the same timeline (verify-motion.mjs PASS).
 */
const FIXTURE: MotionContextResponse = {
  nodes: [
    {
      nodeId: "3021:6487",
      nodeName: "Shape w offset",
      nodeType: "FRAME",
      codeSnippets: {
        motionDev:
          '<motion.div initial={{ rotate: 0, }} animate={{ rotate: [0, 223.149, 360], }} transition={{ rotate: { duration: 2, times: [0, 0.9999, 1], ease: "linear", repeat: Infinity }, }} />',
      },
    },
    {
      nodeId: "3021:6491",
      nodeName: "3D Object - Headphones",
      nodeType: "ROUNDED_RECTANGLE",
      codeSnippets: {
        motionDev:
          '<motion.div initial={{ y: 0, }} animate={{ y: [0, -71.246, -64.253, -19.227, -1.212, 0], }} transition={{ y: { duration: 2, times: [0, 0.8066, 0.9997, 0.9998, 0.9999, 1], ease: [[0.539, 0, 0.312, 0.995], "linear", "linear", "linear", "linear"], repeat: Infinity }, }} />',
      },
    },
    {
      nodeId: "3021:6492",
      nodeName: "Shape",
      nodeType: "ROUNDED_RECTANGLE",
      codeSnippets: {
        motionDev:
          '<motion.div initial={{ width: 160.5, }} animate={{ width: [160.5, 500, 500, 160.5], }} transition={{ width: { duration: 2, times: [0, 0.1956, 0.9999, 1], ease: [[0.539, 0, 0.312, 0.995], "linear", [0.539, 0, 0.312, 0.995]], repeat: Infinity }, }} />',
      },
    },
    {
      nodeId: "3021:6493",
      nodeName: "Headline",
      nodeType: "TEXT",
      codeSnippets: {
        motionDev:
          '<motion.div initial={{ opacity: 0, x: 98.914, }} animate={{ opacity: [0, 0, 1, 1, 0], x: [98.914, 98.914, 0, 0, 98.914], }} transition={{ opacity: { duration: 2, times: [0, 0.0686, 0.2273, 0.9999, 1], ease: ["linear", [0.539, 0, 0.312, 0.995], "linear", [0.539, 0, 0.312, 0.995]], repeat: Infinity }, x: { duration: 2, times: [0, 0.0686, 0.2273, 0.9999, 1], ease: ["linear", [0.539, 0, 0.312, 0.995], "linear", [0.539, 0, 0.312, 0.995]], repeat: Infinity }, }} />',
      },
    },
    {
      nodeId: "3021:6494",
      nodeName: "Knob",
      nodeType: "FRAME",
      codeSnippets: {
        motionDev:
          '<motion.div initial={{ x: -339.087, }} animate={{ x: [-339.087, 0, 0, -339.087], }} transition={{ x: { duration: 2, times: [0, 0.1956, 0.9999, 1], ease: [[0.539, 0, 0.312, 0.995], "linear", [0.539, 0, 0.312, 0.995]], repeat: Infinity }, }} />',
      },
    },
  ],
  timelineCohorts: [
    {
      rootNodeId: "3021:6485",
      durationMs: 2000,
      loopMode: "loop",
      memberNodeIds: ["3021:6487", "3021:6491", "3021:6492", "3021:6493", "3021:6494"],
    },
  ],
};

const SELECTORS: Record<string, string> = {
  "3021:6487": "#shape-w-offset",
  "3021:6491": "#headphones-3d",
  "3021:6492": "#shape-2",
  "3021:6493": "#headline",
  "3021:6494": "#knob",
};

function docs(repeat = 1) {
  return motionContextToDocs(FIXTURE, {
    selectorFor: (n) => SELECTORS[n.nodeId] ?? `#${n.nodeId}`,
    repeat,
  });
}

describe("motionContextToDocs", () => {
  it("produces one doc per animated node with caller-supplied selectors", () => {
    const out = docs();
    expect(out.map((d) => d.selector)).toEqual([
      "#shape-w-offset",
      "#headphones-3d",
      "#shape-2",
      "#headline",
      "#knob",
    ]);
  });

  it("strips the loop-wrap tail and extends the last keyframe to the window end", () => {
    const rotation = docs()[0]?.tracks[0];
    // [0, 223.149, 360] @ [0, .9999, 1]: the 360 is the wrap marker.
    // 223.149° over the 2s window is the true angular speed (the CSS
    // snippet's "360° in 2s" disagrees and is wrong — verified against
    // export_video ground truth).
    expect(rotation?.property).toBe("rotation");
    expect(rotation?.values).toEqual([0, 223.149]);
    expect(rotation?.times).toEqual([0, 1]);
  });

  it("strips multi-keyframe wrap clusters but keeps real sub-second motion", () => {
    const y = docs()[1]?.tracks[0];
    // tail cluster (-19.227, -1.212, 0) spans <1ms each — wrap markers.
    // -64.253 @ 0.9997 ends a 0.386s segment — real, kept, extended to 1.
    expect(y?.values).toEqual([0, -71.246, -64.253]);
    expect(y?.times).toEqual([0, 0.8066, 1]);
  });

  it("keeps hold segments and drops only the wrap snap", () => {
    const width = docs()[2]?.tracks[0];
    expect(width?.values).toEqual([160.5, 500, 500]);
    expect(width?.times).toEqual([0, 0.1956, 1]);
  });

  it("parses multiple properties per node", () => {
    const headline = docs()[3];
    expect(headline?.tracks.map((t) => t.property).sort()).toEqual(["opacity", "x"]);
    const opacity = headline?.tracks.find((t) => t.property === "opacity");
    expect(opacity?.values).toEqual([0, 0, 1, 1]);
    expect(opacity?.times).toEqual([0, 0.0686, 0.2273, 1]);
  });

  it("preserves bezier easing arrays and applies the requested repeat", () => {
    const knob = docs(2)[4]?.tracks[0];
    expect(knob?.ease[0]).toEqual([0.539, 0, 0.312, 0.995]);
    expect(knob?.repeat).toBe(2);
    expect(knob?.duration).toBe(2);
  });

  it("skips nodes without motion.dev snippets", () => {
    const out = motionContextToDocs(
      { nodes: [{ nodeId: "1:1", nodeName: "Static", codeSnippets: { css: "..." } }] },
      { selectorFor: () => "#static" },
    );
    expect(out).toEqual([]);
  });
});
