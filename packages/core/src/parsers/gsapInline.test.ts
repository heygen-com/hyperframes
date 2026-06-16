import { describe, expect, it } from "vitest";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import {
  cloneNode,
  inlineComputedTimelines,
  numericLiteral,
  readProvenance,
  substituteParams,
  tagProvenance,
} from "./gsapInline.js";

// Parse a single expression / statement to its ESTree node.
const expr = (code: string): any =>
  (parse(code, { ecmaVersion: "latest" }).body[0] as any).expression;
const stmt = (code: string): any => parse(code, { ecmaVersion: "latest" }).body[0] as any;
const bind = (entries: Record<string, string>): Map<string, any> =>
  new Map(Object.entries(entries).map(([k, v]) => [k, expr(v)]));

describe("substituteParams", () => {
  it("substitutes a scalar param inside a binary expression", () => {
    const out = substituteParams(cloneNode(expr("at + 0.15")), bind({ at: "1.0" }));
    expect(out.type).toBe("BinaryExpression");
    expect(out.left).toMatchObject({ type: "Literal", value: 1 });
    expect(out.right).toMatchObject({ type: "Literal", value: 0.15 });
  });

  it("substitutes an array param used as a value", () => {
    const out = substituteParams(cloneNode(expr("({ path })")), bind({ path: "[{x:0},{x:1}]" }));
    expect(out.properties[0].value.type).toBe("ArrayExpression");
    expect(out.properties[0].value.elements).toHaveLength(2);
  });

  it("does not substitute a name shadowed by an inner const", () => {
    const out = substituteParams(
      cloneNode(stmt("function f(){ const at = 5; return at; }")),
      bind({ at: "1.0" }),
    );
    const ret = out.body.body[1].argument;
    expect(ret).toMatchObject({ type: "Identifier", name: "at" });
  });

  it("does not substitute a name shadowed by a nested function param", () => {
    const out = substituteParams(cloneNode(expr("(at) => at")), bind({ at: "1.0" }));
    expect(out.body).toMatchObject({ type: "Identifier", name: "at" });
  });

  it("does not substitute object keys or non-computed member properties", () => {
    const obj = substituteParams(cloneNode(expr("({ at: 1 })")), bind({ at: "9" }));
    expect(obj.properties[0].key).toMatchObject({ type: "Identifier", name: "at" });
    const mem = substituteParams(cloneNode(expr("obj.at")), bind({ at: "9" }));
    expect(mem.property).toMatchObject({ type: "Identifier", name: "at" });
  });

  it("does substitute a computed member property", () => {
    const out = substituteParams(cloneNode(expr("obj[at]")), bind({ at: "0" }));
    expect(out.property).toMatchObject({ type: "Literal", value: 0 });
  });

  it("does not mutate the input clone's source", () => {
    const original = expr("at + 0.15");
    substituteParams(cloneNode(original), bind({ at: "1.0" }));
    expect(original.left).toMatchObject({ type: "Identifier", name: "at" });
  });
});

describe("provenance + numericLiteral", () => {
  it("round-trips a provenance tag", () => {
    const node = expr("tl.to('#x', {}, 1)");
    tagProvenance(node, { kind: "helper", fn: "addCycle", callSite: 2 });
    expect(readProvenance(node)).toEqual({ kind: "helper", fn: "addCycle", callSite: 2 });
  });

  it("builds a resolvable numeric literal", () => {
    expect(numericLiteral(3.5)).toMatchObject({ type: "Literal", value: 3.5 });
  });
});

// Resolve only direct literals — enough to drive loop-bound resolution in tests.
const litResolve = (n: any): any => (n?.type === "Literal" ? n.value : undefined);

// The tl.* method of a direct `tl.method(...)` call (test scripts don't chain), or null.
function tlMethod(call: any, tl: string): string | null {
  if (call.callee?.object?.name !== tl) return null;
  const m = call.callee?.property?.name;
  return ["set", "to", "from", "fromTo"].includes(m) ? m : null;
}

function run(code: string, tl = "tl"): { ast: any; tweens: Array<{ prov: any; pos: any }> } {
  const ast: any = parse(code, { ecmaVersion: "latest" });
  inlineComputedTimelines(ast, tl, litResolve);
  const tweens: Array<{ prov: any; pos: any }> = [];
  simple(ast, {
    CallExpression(n: any) {
      const m = tlMethod(n, tl);
      if (m) tweens.push({ prov: readProvenance(n), pos: n.arguments?.[m === "fromTo" ? 3 : 2] });
    },
  });
  return { ast, tweens };
}

const kinds = (t: Array<{ prov: any }>): any[] => t.map((x) => x.prov?.kind);
const sites = (t: Array<{ prov: any }>): any[] => t.map((x) => x.prov?.callSite);
const iters = (t: Array<{ prov: any }>): any[] => t.map((x) => x.prov?.iteration);

describe("inlineComputedTimelines — helpers", () => {
  it("expands a helper called N times, substituting positions per call", () => {
    const { tweens } = run(`const tl=gsap.timeline();
      function addCycle(at){ tl.to("#p", {}, at + 0.3); }
      addCycle(1.0); addCycle(3.6);`);
    expect(tweens).toHaveLength(2);
    expect(kinds(tweens)).toEqual(["helper", "helper"]);
    expect(sites(tweens)).toEqual([1, 2]);
    expect(tweens[0]!.pos).toMatchObject({ type: "BinaryExpression", left: { value: 1 } });
    expect(tweens[1]!.pos).toMatchObject({ left: { value: 3.6 } });
  });

  it("expands every tween in a multi-tween helper body", () => {
    const { tweens } = run(`const tl=gsap.timeline();
      function addCycle(at){ tl.to("#a", {}, at); tl.to("#b", {}, at + 1); }
      addCycle(1); addCycle(5);`);
    expect(tweens).toHaveLength(4);
    expect(sites(tweens)).toEqual([1, 1, 2, 2]);
  });

  it("inlines nested helpers to a fixpoint", () => {
    const { tweens } = run(`const tl=gsap.timeline();
      function inner(t){ tl.to("#x", {}, t); }
      function outer(at){ inner(at); }
      outer(5);`);
    expect(tweens).toHaveLength(1);
    expect(tweens[0]!.prov?.fn).toBe("inner");
    expect(tweens[0]!.pos).toMatchObject({ type: "Literal", value: 5 });
  });

  it("caps runaway recursion instead of hanging", () => {
    const { tweens } = run(`const tl=gsap.timeline();
      function r(n){ tl.to("#x", {}, n); r(n); }
      r(0);`);
    expect(tweens.length).toBeGreaterThan(0);
    expect(tweens.length).toBeLessThanOrEqual(8);
  });

  it("leaves a non-timeline helper untouched", () => {
    const { ast, tweens } = run(`function bez(t){ return t * 2; }
      const tl=gsap.timeline();
      tl.to("#x", {}, bez(1));`);
    expect(
      ast.body.some((s: any) => s.type === "FunctionDeclaration" && s.id?.name === "bez"),
    ).toBe(true);
    expect(tweens).toHaveLength(1);
    expect(tweens[0]!.prov).toBeUndefined(); // literal tween, no provenance tag
  });
});

describe("inlineComputedTimelines — loops", () => {
  it("unrolls a for-loop with literal bounds", () => {
    const { tweens } = run(`const tl=gsap.timeline();
      for (let i = 0; i < 3; i++) { tl.to("#x", {}, i * 0.5); }`);
    expect(tweens).toHaveLength(3);
    expect(iters(tweens)).toEqual([0, 1, 2]);
    expect(tweens.map((t) => t.pos.left.value)).toEqual([0, 1, 2]);
  });

  it("unrolls forEach over an inline array", () => {
    const { tweens } = run(`const tl=gsap.timeline();
      [{t:1},{t:2}].forEach((d) => { tl.to("#x", {}, d.t); });`);
    expect(tweens).toHaveLength(2);
    expect(kinds(tweens)).toEqual(["loop", "loop"]);
  });
});
