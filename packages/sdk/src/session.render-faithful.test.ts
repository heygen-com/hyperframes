/**
 * WS-F — Render-faithfulness test.
 *
 * Contract: after a representative op batch (setStyle + setText + setTiming +
 * addGsapTween + moveElement), session.serialize() emits fully override-baked,
 * render-ready HTML containing ALL edits. This is the guarantee that
 * HyperframesRenderActivityInput{ source_s3_key(baked HTML) + variables } can
 * be satisfied without a separate override-set field.
 *
 * Also asserts:
 *   - The GSAP <script> is present in serialized output with new tweens applied.
 *   - data-composition-variables on <html> is preserved unchanged (variables live
 *     via the variables dict, not via re-bake, so the attribute must survive).
 *
 * Decision recorded: no SDK bake helper. session.serialize() IS the bake.
 * The content-address → zip → S3 upload → pointer-swap flow is host/backend
 * (WS-P / WS-R); this test pins only the SDK-side contract.
 */

import { describe, it, expect } from "vitest";
import { openComposition } from "./session.js";

// ─── Fixture ──────────────────────────────────────────────────────────────────

const VARIABLES = JSON.stringify([
  { id: "headline", type: "string", label: "Headline", default: "Hello" },
  { id: "accent", type: "color", label: "Accent color", default: "#ff0000" },
]);

const GSAP_SCRIPT = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { opacity: 1, duration: 0.5, ease: "power2.out" }, 0.2);
window.__timelines = { t: tl };`;

/**
 * A full-document fixture (wrapped=false) so that serialize() emits the
 * complete <!DOCTYPE html> shell, including the <html> attributes that carry
 * data-composition-variables.
 */
const BASE_HTML = `<!DOCTYPE html>
<html data-composition-variables='${VARIABLES}'>
<head></head>
<body>
<div data-hf-id="hf-stage" data-hf-root data-width="1920" data-height="1080" data-duration="8">
  <h1 data-hf-id="hf-title" data-start="0" data-end="5" data-track-index="0"
      style="color: #fff; font-size: 64px; position: absolute">Hello World</h1>
  <img data-hf-id="hf-logo" src="/logo.png" alt="Logo"
       data-x="100" data-y="200" data-start="0" data-end="8" />
  <p data-hf-id="hf-body" data-start="1" data-end="6"
     style="font-size: 24px">Body copy here</p>
  <div data-hf-id="hf-box" style="opacity: 0; position: absolute"
       data-x="50" data-y="50" data-start="0" data-end="8"></div>
  <script>${GSAP_SCRIPT}</script>
</div>
</body>
</html>`;

// ─── helpers ──────────────────────────────────────────────────────────────────

function extractScript(html: string): string {
  const m = /<script>([\s\S]*?)<\/script>/i.exec(html);
  return m ? (m[1]?.trim() ?? "") : "";
}

// ─── render-faithfulness ──────────────────────────────────────────────────────

describe("serialize() render-faithfulness (WS-F)", () => {
  it("setStyle edit is present in serialized output", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#ff6600", fontSize: "80px" });
    const html = comp.serialize();
    expect(html).toContain("color: #ff6600");
    expect(html).toContain("font-size: 80px");
  });

  it("setText edit is present in serialized output", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setText("hf-title", "Baked Headline");
    const html = comp.serialize();
    expect(html).toContain("Baked Headline");
    expect(html).not.toContain("Hello World");
  });

  it("setTiming edit is present in serialized output", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setTiming("hf-body", { start: 2, duration: 3 });
    const html = comp.serialize();
    // data-start and data-end are the serialized form of timing
    expect(html).toContain('data-start="2"');
    expect(html).toContain('data-end="5"');
  });

  it("moveElement edit is present in serialized output", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.dispatch({ type: "moveElement", target: "hf-logo", x: 500, y: 300 });
    const html = comp.serialize();
    expect(html).toContain('data-x="500"');
    expect(html).toContain('data-y="300"');
  });

  it("addGsapTween edit is present in the serialized <script>", async () => {
    const comp = await openComposition(BASE_HTML);
    const tweenId = comp.addGsapTween("hf-box", {
      method: "to",
      duration: 0.8,
      position: 1,
      properties: { x: 200, scale: 1.5 },
    });
    expect(tweenId).not.toBe("");
    const html = comp.serialize();
    const script = extractScript(html);
    expect(script).toContain("x: 200");
    expect(script).toContain("scale: 1.5");
  });

  it("full op batch: all five edits survive serialize() together", async () => {
    const comp = await openComposition(BASE_HTML);

    // Apply all five op types in a single session
    comp.setStyle("hf-title", { color: "#cc00ff", letterSpacing: "2px" });
    comp.setText("hf-title", "Render Ready");
    comp.setTiming("hf-title", { start: 0.5, duration: 4 });
    comp.dispatch({ type: "moveElement", target: "hf-logo", x: 900, y: 50 });
    const tweenId = comp.addGsapTween("hf-box", {
      method: "from",
      duration: 0.6,
      position: 0.5,
      properties: { opacity: 0, y: -40 },
    });

    const html = comp.serialize();

    // setStyle
    expect(html).toContain("color: #cc00ff");
    expect(html).toContain("letter-spacing: 2px");

    // setText
    expect(html).toContain("Render Ready");

    // setTiming → data-start / data-end
    expect(html).toContain('data-start="0.5"');
    expect(html).toContain('data-end="4.5"');

    // moveElement
    expect(html).toContain('data-x="900"');
    expect(html).toContain('data-y="50"');

    // addGsapTween — id is returned and script contains new tween
    expect(tweenId).not.toBe("");
    const script = extractScript(html);
    expect(script).toContain("y: -40");
    expect(script).toContain("opacity: 0");
  });

  it("data-composition-variables attribute is preserved in serialized output", async () => {
    const comp = await openComposition(BASE_HTML);
    // Apply an edit to force a real mutation
    comp.setStyle("hf-title", { color: "#0000ff" });
    const html = comp.serialize();
    // The attribute must survive serialize(). linkedom entity-encodes JSON inside
    // attribute values (& → &amp; etc.), so check for the encoded form of the key names.
    expect(html).toContain("data-composition-variables=");
    expect(html).toContain("&quot;headline&quot;");
    expect(html).toContain("&quot;accent&quot;");
  });

  it("serialize → reopen preserves baked state (round-trip)", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#abcdef" });
    comp.setText("hf-body", "Round-tripped body");

    const baked = comp.serialize();
    const comp2 = await openComposition(baked);

    expect(comp2.getElement("hf-title")?.inlineStyles.color).toBe("#abcdef");
    expect(comp2.getElement("hf-body")?.text).toContain("Round-tripped body");
  });
});
