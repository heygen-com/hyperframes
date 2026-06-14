/**
 * setClassStyle handler tests — flat CSS rule upsert via <style> element.
 */

import { describe, it, expect } from "vitest";
import { parseMutable } from "./model.js";
import { applyOp, validateOp } from "./mutate.js";
import { applyPatchesToDocument } from "./apply-patches.js";
import { serializeDocument } from "./serialize.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CSS = `.box { opacity: 0; transform: translateX(-50px); }
.title { color: #fff; font-size: 64px; }
`;

function makeHtml(style = CSS) {
  return `<!DOCTYPE html><html><head><style>${style}</style></head><body>
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div data-hf-id="hf-box" class="box"></div>
  <h1 data-hf-id="hf-title" class="title">Hello</h1>
</div></body></html>`.trim();
}

function fresh(style = CSS) {
  return parseMutable(makeHtml(style));
}

function getStyleText(parsed: ReturnType<typeof parseMutable>): string {
  const doc = serializeDocument(parsed);
  const m = /<style>([\s\S]*?)<\/style>/i.exec(doc);
  return m ? m[1]! : "";
}

// ─── validateOp ───────────────────────────────────────────────────────────────

describe("validateOp setClassStyle", () => {
  it("returns ok:true (always valid — creates <style> if absent)", () => {
    expect(
      validateOp(fresh(), { type: "setClassStyle", selector: ".box", styles: { opacity: "1" } }).ok,
    ).toBe(true);
  });

  it("returns ok:true even when no <style> element present", () => {
    const noStyle = parseMutable(
      `<div data-hf-id="hf-stage" data-hf-root><div data-hf-id="hf-box"></div></div>`,
    );
    expect(
      validateOp(noStyle, { type: "setClassStyle", selector: ".box", styles: { opacity: "1" } }).ok,
    ).toBe(true);
  });
});

// ─── setClassStyle: update existing rule ──────────────────────────────────────

describe("setClassStyle — update existing rule", () => {
  function applyBoxOpacity1() {
    const result = applyOp(fresh(), {
      type: "setClassStyle",
      selector: ".box",
      styles: { opacity: "1" },
    });
    return String(result.forward[0]?.value ?? "");
  }

  it("adds a new property to an existing rule", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setClassStyle",
      selector: ".box",
      styles: { color: "red" },
    });
    expect(result.forward).toHaveLength(1);
    expect(result.forward[0]?.path).toBe("/style/css");
    const newCss = String(result.forward[0]?.value ?? "");
    expect(newCss).toContain("color: red");
    expect(newCss).toContain("opacity: 0");
  });

  it("overwrites an existing property value", () => {
    const newCss = applyBoxOpacity1();
    expect(newCss).toContain("opacity: 1");
    expect(newCss).not.toContain("opacity: 0");
    expect(newCss).toContain("translateX(-50px)");
  });

  it("removes a property when value is null", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setClassStyle",
      selector: ".box",
      styles: { opacity: null },
    });
    const newCss = String(result.forward[0]?.value ?? "");
    expect(newCss).not.toContain("opacity");
    expect(newCss).toContain("translateX(-50px)");
  });

  it("leaves other rules untouched", () => {
    const newCss = applyBoxOpacity1();
    expect(newCss).toContain(".title");
    expect(newCss).toContain("color: #fff");
  });
});

// ─── setClassStyle: insert new rule ──────────────────────────────────────────

describe("setClassStyle — insert new rule", () => {
  it("appends a new rule when selector not found", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setClassStyle",
      selector: ".new",
      styles: { display: "flex", gap: "8px" },
    });
    const newCss = String(result.forward[0]?.value ?? "");
    expect(newCss).toContain(".new");
    expect(newCss).toContain("display: flex");
    expect(newCss).toContain("gap: 8px");
    expect(newCss).toContain(".box");
  });

  it("creates <style> element when none exists", () => {
    const noStyle = parseMutable(
      `<div data-hf-id="hf-stage" data-hf-root><div data-hf-id="hf-box"></div></div>`,
    );
    const result = applyOp(noStyle, {
      type: "setClassStyle",
      selector: ".box",
      styles: { opacity: "1" },
    });
    expect(result.forward).toHaveLength(1);
    const newCss = String(result.forward[0]?.value ?? "");
    expect(newCss).toContain(".box");
    expect(newCss).toContain("opacity: 1");
  });
});

// ─── no-op cases ─────────────────────────────────────────────────────────────

describe("setClassStyle — no-ops", () => {
  it("returns EMPTY when all values are null and selector not found", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setClassStyle",
      selector: ".nonexistent",
      styles: { opacity: null },
    });
    expect(result.forward).toHaveLength(0);
  });
});

// ─── inverse restores original ────────────────────────────────────────────────

describe("setClassStyle — inverse patches", () => {
  it("inverse restores original CSS", () => {
    const parsed = fresh();
    const original = getStyleText(parsed);
    const result = applyOp(parsed, {
      type: "setClassStyle",
      selector: ".box",
      styles: { opacity: "1", color: "blue" },
    });
    applyPatchesToDocument(parsed, result.inverse);
    expect(getStyleText(parsed)).toBe(original);
  });

  it("undo on style-less composition does not create spurious <style> element", () => {
    const noStyle = parseMutable(
      `<div data-hf-id="hf-stage" data-hf-root><div data-hf-id="hf-box"></div></div>`,
    );
    const result = applyOp(noStyle, {
      type: "setClassStyle",
      selector: ".box",
      styles: { opacity: "1" },
    });
    applyPatchesToDocument(noStyle, result.inverse);
    const html = serializeDocument(noStyle);
    expect(html).not.toContain("<style");
  });
});

// ─── semicolon-containing CSS values ─────────────────────────────────────────

describe("setClassStyle — CSS values with semicolons (data URIs)", () => {
  it("preserves data URI value when updating another property in same rule", () => {
    const dataUriCss = ".hero { background: url(data:image/png;base64,abc=); color: red; }\n";
    const parsed = fresh(dataUriCss);
    const result = applyOp(parsed, {
      type: "setClassStyle",
      selector: ".hero",
      styles: { color: "blue" },
    });
    const newCss = String(result.forward[0]?.value ?? "");
    expect(newCss).toContain("url(data:image/png;base64,abc=)");
    expect(newCss).toContain("color: blue");
    expect(newCss).not.toContain("color: red");
  });
});

// ─── DOM side-effect ─────────────────────────────────────────────────────────

describe("setClassStyle — DOM mutation", () => {
  it("mutates the live <style> element in the document", () => {
    const parsed = fresh();
    applyOp(parsed, {
      type: "setClassStyle",
      selector: ".box",
      styles: { opacity: "1" },
    });
    expect(getStyleText(parsed)).toContain("opacity: 1");
    expect(getStyleText(parsed)).not.toContain("opacity: 0");
  });
});
