import { describe, it, expect } from "vitest";
import { createProceduralAdapter, evaluateExpression } from "./procedural";

// ── Unit tests for the restricted math evaluator ────────────────────────────

describe("evaluateExpression", () => {
  it("evaluates basic arithmetic", () => {
    expect(evaluateExpression("2 + 3", 0)).toEqual({ value: 5, ok: true });
    expect(evaluateExpression("10 - 4 * 2", 0)).toEqual({ value: 2, ok: true });
    expect(evaluateExpression("(10 - 4) * 2", 0)).toEqual({ value: 12, ok: true });
  });

  it("supports the frame variable", () => {
    expect(evaluateExpression("frame * 2", 15)).toEqual({ value: 30, ok: true });
    expect(evaluateExpression("frame + 1", 0)).toEqual({ value: 1, ok: true });
  });

  it("supports whitelisted math functions", () => {
    const result = evaluateExpression("sin(frame) * 50", 30);
    expect(result.ok).toBe(true);
    expect(result.value).toBeCloseTo(Math.sin(30) * 50);
  });

  it("supports Math.xxx prefix notation", () => {
    const result = evaluateExpression("Math.sin(frame) * 50", 30);
    expect(result.ok).toBe(true);
    expect(result.value).toBeCloseTo(Math.sin(30) * 50);
  });

  it("supports constants like PI", () => {
    const result = evaluateExpression("PI * 2", 0);
    expect(result.ok).toBe(true);
    expect(result.value).toBeCloseTo(Math.PI * 2);
  });

  it("supports multi-arg functions (min, max, pow)", () => {
    expect(evaluateExpression("min(3, 7)", 0)).toEqual({ value: 3, ok: true });
    expect(evaluateExpression("max(3, 7)", 0)).toEqual({ value: 7, ok: true });
    expect(evaluateExpression("pow(2, 8)", 0)).toEqual({ value: 256, ok: true });
  });

  it("supports unary minus", () => {
    expect(evaluateExpression("-frame", 5)).toEqual({ value: -5, ok: true });
    expect(evaluateExpression("-(3 + 2)", 0)).toEqual({ value: -5, ok: true });
  });

  it("rejects window.alert — returns 0", () => {
    const result = evaluateExpression("window.alert('hack')", 0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(0);
  });

  it("rejects eval() — returns 0", () => {
    const result = evaluateExpression("eval('1+1')", 0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(0);
  });

  it("rejects arbitrary identifiers — returns 0", () => {
    const result = evaluateExpression("abc + 123", 0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(0);
  });

  it("rejects property access chains — returns 0", () => {
    const result = evaluateExpression("globalThis.process.exit(1)", 0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(0);
  });

  it("rejects template literals — returns 0", () => {
    const result = evaluateExpression("`${1+1}`", 0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(0);
  });

  it("handles division by zero safely", () => {
    const result = evaluateExpression("frame / 0", 10);
    // Parser guards division by zero and returns 0
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
  });
});

// ── Integration tests for the adapter ───────────────────────────────────────

describe("Procedural Adapter", () => {
  it("evaluates Math.sin properly via DOM attribute", () => {
    const adapter = createProceduralAdapter({ getCanonicalFps: () => 30 });

    const div = document.createElement("div");
    div.setAttribute("data-animate-x", "Math.sin(frame) * 50");
    document.body.appendChild(div);

    adapter.discover();
    adapter.seek({ time: 1 }); // 30 frames

    const expected = Math.sin(30) * 50;
    expect(div.style.transform).toBe(`translateX(${expected}px)`);

    document.body.removeChild(div);
  });

  it("rejects unsafe code and produces no transform", () => {
    const adapter = createProceduralAdapter({ getCanonicalFps: () => 30 });

    const div = document.createElement("div");
    div.setAttribute("data-animate-x", "window.alert('hack')");
    document.body.appendChild(div);

    adapter.discover();
    adapter.seek({ time: 1 });

    // Unsafe expression is rejected; no transform is applied
    expect(div.style.transform).toBe("");

    document.body.removeChild(div);
  });

  it("rejects invalid identifiers and produces no transform", () => {
    const adapter = createProceduralAdapter({ getCanonicalFps: () => 30 });

    const div = document.createElement("div");
    div.setAttribute("data-animate-x", "abc + 123");
    document.body.appendChild(div);

    adapter.discover();
    adapter.seek({ time: 1 });

    expect(div.style.transform).toBe("");

    document.body.removeChild(div);
  });

  it("does not crash and does not throw on any malicious input", () => {
    const adapter = createProceduralAdapter({ getCanonicalFps: () => 30 });

    const div = document.createElement("div");
    div.setAttribute("data-animate-x", "require('child_process').execSync('rm -rf /')");
    document.body.appendChild(div);

    adapter.discover();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
    expect(div.style.transform).toBe("");

    document.body.removeChild(div);
  });
});
