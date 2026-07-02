/**
 * T6a — GSAP parser golden tests (baseline for the Recast → Meriyah swap).
 *
 * These snapshots capture the exact output of parseGsapScript +
 * serializeGsapAnimations under Recast/Babel before any parser change.
 * When the Meriyah swap lands, run `vitest --update-snapshots` to regenerate
 * and diff the goldens — any change is a regression candidate.
 *
 * Three representative scripts:
 *   minimal  — 2 tl.to calls, simple numeric selectors (macos-notification)
 *   moderate — 6 tl.to calls, multiple selectors (yt-lower-third)
 *   complex  — stagger, chained .from()/.to(), const/defaults (vpn-youtube-spot)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGsapScriptAcorn as parseGsapScript } from "./gsapParserAcorn.js";
import { serializeGsapAnimations } from "./gsapSerialize.js";

const __goldens__ = join(fileURLToPath(import.meta.url), "..", "__goldens__");
const g = (name: string) => join(__goldens__, name);

// ---------------------------------------------------------------------------
// Corpus scripts (inline so goldens are not coupled to registry file changes)
// ---------------------------------------------------------------------------

const MINIMAL_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
var notification = document.getElementById("notification");
gsap.set(notification, { x: 420, opacity: 0 });
tl.to(notification, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.2);
tl.to(notification, { x: 420, opacity: 0, duration: 0.3, ease: "power3.in" }, 4.2);
window.__timelines["macos-notification"] = tl;`;

const MODERATE_SCRIPT = `\
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
var card = document.getElementById("card");
var btn = document.getElementById("subscribe-btn");
var textSub = document.getElementById("btn-subscribe");
var textSubd = document.getElementById("btn-subscribed");
gsap.set(card, { y: 300, opacity: 0 });
tl.to(card, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.1);
tl.to(btn, { scale: 0.92, duration: 0.15, ease: "power2.out" }, 1.0);
tl.to(btn, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.4)" }, 1.15);
tl.to(textSub, { opacity: 0, duration: 0.08, ease: "none" }, 1.15);
tl.to(textSubd, { opacity: 1, duration: 0.08, ease: "none" }, 1.18);
tl.to(card, { y: 300, opacity: 0, duration: 0.25, ease: "power3.in" }, 3.8);
window.__timelines["yt-lower-third"] = tl;`;

const COMPLEX_SCRIPT = `\
window.__timelines = window.__timelines || {};
gsap.defaults({ force3D: true });
const tl = gsap.timeline({ paused: true, defaults: { duration: 0.45, ease: "power3.out" } });
tl.from(".headline span", { y: 46, opacity: 0, stagger: 0.055, duration: 0.38, ease: "back.out(1.35)" }, 0.05)
  .from(".headline .sub", { y: 20, opacity: 0, duration: 0.28 }, 0.2)
  .from(".ambient-word", { scale: 0.92, opacity: 0, duration: 0.5 }, 0.08)
  .from(".ambient-line", { scaleX: 0, opacity: 0, stagger: 0.08, duration: 0.42 }, 0.16);
window.__timelines["vpn-youtube-spot"] = tl;`;

// fromTo: exercises the three-argument (fromArg, toArg, position) AST path and
// negative numeric literals (UnaryExpression arm in resolveNode).
const FROMTO_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
var hero = document.getElementById("hero");
var caption = document.getElementById("caption");
tl.fromTo(hero, { x: -200, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0.1);
tl.fromTo(caption, { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, 0.5);
window.__timelines["hero-reveal"] = tl;`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAndSerialize(script: string): { parsed: string; serialized: string } {
  const result = parseGsapScript(script);
  const serialized = serializeGsapAnimations(result.animations, result.timelineVar, {
    preamble: result.preamble,
    postamble: result.postamble,
  });
  return { parsed: JSON.stringify(result, null, 2), serialized };
}

// ---------------------------------------------------------------------------
// Golden tests
// ---------------------------------------------------------------------------

describe("T6a — GSAP parser golden tests (Recast/Babel baseline)", () => {
  describe("minimal — 2 tl.to calls (macos-notification)", () => {
    let parsed: string;
    let serialized: string;
    beforeAll(() => {
      ({ parsed, serialized } = parseAndSerialize(MINIMAL_SCRIPT));
    });

    it("parseGsapScript output matches golden", async () => {
      await expect(parsed).toMatchFileSnapshot(g("minimal.parsed.json"));
    });

    it("serializeGsapAnimations output matches golden", async () => {
      await expect(serialized).toMatchFileSnapshot(g("minimal.serialized.js"));
    });
  });

  describe("moderate — 6 tl.to calls, multiple selectors (yt-lower-third)", () => {
    let parsed: string;
    let serialized: string;
    beforeAll(() => {
      ({ parsed, serialized } = parseAndSerialize(MODERATE_SCRIPT));
    });

    it("parseGsapScript output matches golden", async () => {
      await expect(parsed).toMatchFileSnapshot(g("moderate.parsed.json"));
    });

    it("serializeGsapAnimations output matches golden", async () => {
      await expect(serialized).toMatchFileSnapshot(g("moderate.serialized.js"));
    });
  });

  describe("complex — stagger + chained .from() calls (vpn-youtube-spot)", () => {
    let parsed: string;
    let serialized: string;
    beforeAll(() => {
      ({ parsed, serialized } = parseAndSerialize(COMPLEX_SCRIPT));
    });

    it("parseGsapScript output matches golden", async () => {
      await expect(parsed).toMatchFileSnapshot(g("complex.parsed.json"));
    });

    it("serializeGsapAnimations output matches golden", async () => {
      await expect(serialized).toMatchFileSnapshot(g("complex.serialized.js"));
    });
  });

  describe("fromTo — two tl.fromTo calls with negative positions (hero-reveal)", () => {
    let parsed: string;
    let serialized: string;
    beforeAll(() => {
      ({ parsed, serialized } = parseAndSerialize(FROMTO_SCRIPT));
    });

    it("parseGsapScript output matches golden", async () => {
      await expect(parsed).toMatchFileSnapshot(g("fromto.parsed.json"));
    });

    it("serializeGsapAnimations output matches golden", async () => {
      await expect(serialized).toMatchFileSnapshot(g("fromto.serialized.js"));
    });
  });
});
