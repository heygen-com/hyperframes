import { describe, expect, it } from "vitest";
import { parse } from "acorn";
import {
  cloneNode,
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
