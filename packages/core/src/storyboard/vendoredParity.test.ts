import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseStoryboard as coreParse } from "./parseStoryboard.js";

// Sync guard for the hand-vendored parser.
//
// Each standalone skill ships a plain-JS copy of this parser at
// scripts/lib/storyboard.mjs — skills install via `npx skills add`, where a
// script can't reach @hyperframes/core (and the core export is .ts that node
// can't load). The copies MUST stay in lockstep with core. This test fails the
// moment they drift, so a parser change can't silently leave the skills behind:
//   1. every vendored copy is byte-identical to the others, and
//   2. a vendored copy parses a representative storyboard identically to core.
// If you change the parser, update every path below in the same commit.
const VENDORED_RELATIVE = [
  "../../../../skills/faceless-explainer/scripts/lib/storyboard.mjs",
  "../../../../skills/pr-to-video/scripts/lib/storyboard.mjs",
  "../../../../skills/product-launch-video/scripts/lib/storyboard.mjs",
];

const vendoredUrls = VENDORED_RELATIVE.map((rel) => new URL(rel, import.meta.url));

// Exercises frontmatter (known keys + an unknown global), H2/H3 frame headings,
// every recognized meta key + an alias (transition / vo / description), an unknown
// status (warning + stash under extra), an unparseable duration (warning), unknown
// extra keys, and free-form narrative — the surfaces most likely to drift.
const SAMPLE = `---
format: 1080x1920
message: "Ship it"
arc: Hook → Proof → CTA
audience: builders
campaign: spring
---

## Frame 1 — Hook
- duration: 3s
- status: animated
- transition: cut
- vo: "Open cold."
- src: compositions/frames/01-hook.html
- poster: 2s
- effect: shimmer

Open on the promise.

### Beat 2 — Detail
- duration: four
- status: glowing
- description: a quiet hold
- voiceover: "The payoff."

Land it.
`;

describe("vendored storyboard parser parity", () => {
  it("every vendored copy is byte-identical", () => {
    const bodies = vendoredUrls.map((u) => readFileSync(fileURLToPath(u), "utf8"));
    for (let i = 1; i < bodies.length; i++) {
      expect(
        bodies[i],
        `${VENDORED_RELATIVE[i]} drifted from ${VENDORED_RELATIVE[0]} — re-vendor it`,
      ).toBe(bodies[0]);
    }
  });

  it("a vendored copy parses identically to core", async () => {
    const vendored = await import(vendoredUrls[0].href);
    expect(vendored.parseStoryboard(SAMPLE)).toEqual(coreParse(SAMPLE));
  });
});
