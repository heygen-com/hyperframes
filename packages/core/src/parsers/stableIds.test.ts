/**
 * @vitest-environment jsdom
 *
 * T2 — Stable id spec (spec for R1).
 *
 * These tests define what "stable hf- id" means BEFORE R1 implements it.
 * They are intentionally red until R1 lands.
 *
 * Currently failing (spec): tests 1, 2, 3 — parser assigns `element-N` not `hf-xxxx`.
 * Currently passing (baseline): tests 4, 5, 6, 7 — these already hold and must not regress.
 *
 * Scope: id assignment and stability only. Round-trip fidelity is T1 territory.
 */
import { describe, expect, it } from "vitest";
import { parseHtml } from "./htmlParser.js";
import { generateHyperframesHtml } from "../generators/hyperframes.js";
import type { ParsedHtml } from "./htmlParser.js";

function maxEndTime(elements: ParsedHtml["elements"]): number {
  if (elements.length === 0) return 0;
  return Math.max(...elements.map((e) => e.startTime + e.duration));
}

function serialize(parsed: ParsedHtml): string {
  return generateHyperframesHtml(parsed.elements, maxEndTime(parsed.elements), {
    compositionId: "test-comp",
    resolution: parsed.resolution,
    styles: parsed.styles ?? undefined,
    keyframes: parsed.keyframes,
    stageZoomKeyframes: parsed.stageZoomKeyframes,
  });
}

describe("T2 — stable element ids (spec for R1)", () => {
  // --- Spec (red until R1) ---

  it.fails("[spec] elements without an id get a hf- prefixed id at parse", () => {
    const html = `<html><body><div id="stage">
      <img src="logo.svg" data-start="0" data-end="5" data-name="Logo" />
      <div data-start="0" data-end="5" data-name="Card"><div>Text</div></div>
    </div></body></html>`;
    const { elements } = parseHtml(html);
    for (const el of elements) {
      expect(el.id).toMatch(/^hf-/);
    }
  });

  it.fails("[spec] generated hf- ids match /^hf-[a-z0-9]{4}$/", () => {
    const html = `<html><body><div id="stage">
      <div data-start="0" data-end="5" data-name="Unnamed"><div>X</div></div>
      <video data-start="1" data-end="6" src="v.mp4" data-name="Clip"></video>
    </div></body></html>`;
    const { elements } = parseHtml(html);
    const noPreExistingId = elements.filter((e) => e.id !== "stage");
    for (const el of noPreExistingId) {
      expect(el.id).toMatch(/^hf-[a-z0-9]{4}$/);
    }
  });

  it.fails("[spec] adding an element before existing ones does not change existing ids", () => {
    const base = `<html><body><div id="stage">
      <div data-start="0" data-end="5" data-name="AlphaEl"><div>A</div></div>
      <div data-start="1" data-end="6" data-name="BetaEl"><div>B</div></div>
    </div></body></html>`;
    const withPrepend = `<html><body><div id="stage">
      <div data-start="0" data-end="4" data-name="NewEl"><div>New</div></div>
      <div data-start="0" data-end="5" data-name="AlphaEl"><div>A</div></div>
      <div data-start="1" data-end="6" data-name="BetaEl"><div>B</div></div>
    </div></body></html>`;
    const baseAlpha = parseHtml(base).elements.find((e) => e.name === "AlphaEl");
    const extendedAlpha = parseHtml(withPrepend).elements.find((e) => e.name === "AlphaEl");
    expect(baseAlpha).toBeDefined();
    expect(extendedAlpha).toBeDefined();
    // With counter-based ids: base AlphaEl = element-1, extended AlphaEl = element-2 — FAILS.
    // With hf- stable ids: both = same hf-xxxx — PASSES (R1 target).
    expect(extendedAlpha?.id).toBe(baseAlpha?.id);
  });

  // --- Baseline (already pass, must not regress) ---

  it("elements with an existing id keep it unchanged", () => {
    const html = `<html><body><div id="stage">
      <div id="my-title" data-start="0" data-end="5" data-name="Title"><div>Hi</div></div>
    </div></body></html>`;
    const { elements } = parseHtml(html);
    expect(elements.some((e) => e.id === "my-title")).toBe(true);
  });

  it("ids are deterministic: same input produces same ids on re-parse", () => {
    const html = `<html><body><div id="stage">
      <div data-start="0" data-end="5" data-name="A"><div>A</div></div>
      <div data-start="0" data-end="5" data-name="B"><div>B</div></div>
    </div></body></html>`;
    const first = parseHtml(html).elements.map((e) => e.id);
    const second = parseHtml(html).elements.map((e) => e.id);
    expect(first).toEqual(second);
  });

  it("ids are unique within a document", () => {
    const html = `<html><body><div id="stage">
      <div data-start="0" data-end="3" data-name="A"><div>A</div></div>
      <div data-start="1" data-end="4" data-name="B"><div>B</div></div>
      <div data-start="2" data-end="5" data-name="C"><div>C</div></div>
    </div></body></html>`;
    const ids = parseHtml(html).elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("two elements with identical markup get distinct ids (no content-hash collision)", () => {
    // Ensures R1's id derivation includes position or a sibling counter,
    // not just content — two structurally identical elements must not collide.
    const html = `<html><body><div id="stage">
      <div data-start="0" data-end="5" data-name="X"><div>Same</div></div>
      <div data-start="0" data-end="5" data-name="X"><div>Same</div></div>
    </div></body></html>`;
    const { elements } = parseHtml(html);
    const ids = elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ids survive a serialize → re-parse round-trip", () => {
    const html = `<html><body><div id="stage">
      <div id="my-anchor" data-start="0" data-end="5" data-name="Anchor"><div>Content</div></div>
      <img src="photo.jpg" data-start="1" data-end="8" data-name="Photo" />
    </div></body></html>`;
    const original = parseHtml(html);
    const reparsed = parseHtml(serialize(original));
    const origIds = original.elements.map((e) => e.id).sort();
    const roundIds = reparsed.elements.map((e) => e.id).sort();
    expect(roundIds).toEqual(origIds);
  });

  it.todo("sub-composition instances get scoped ids (compositionId/hf-x) — requires SDK session");
});
