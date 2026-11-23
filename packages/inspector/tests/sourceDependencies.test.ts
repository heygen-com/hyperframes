import { describe, expect, it } from "vitest";
import { sourceDependencies } from "../src/sourceDependencies";

function definitions(code: string, statement: string) {
  const start = code.indexOf(statement);
  return sourceDependencies(code)({ start, end: start + statement.length }).map(({ start, end }) =>
    code.slice(start, end),
  );
}

describe("animation source dependencies", () => {
  it("resolves multiline arguments and transitive values without unrelated declarations", () => {
    const code = `const distance = -15;
const target = document.querySelector('.dot');
const unused = {y: 999};
const settings = {
  y: distance,
  duration: 0.6
};
tl.to(target, settings, 1.4);`;
    const result = definitions(code, "tl.to(target, settings, 1.4);");
    expect(result).toEqual([
      "const distance = -15;",
      "const target = document.querySelector('.dot');",
      "const settings = {\n  y: distance,\n  duration: 0.6\n};",
    ]);
  });
  it("respects shadowing and ignores property names and strings", () => {
    const code = `const settings = {y: 999};
const duration = 999;
{
 const settings = {duration: 0.6, label: 'duration'};
 tl.to('.dot', settings);
}`;
    expect(definitions(code, "tl.to('.dot', settings);")).toEqual([
      "const settings = {duration: 0.6, label: 'duration'};",
    ]);
  });
  it("does not resolve a parameter to an unrelated outer variable", () => {
    const code = `const settings = {y: 999};
function animate(settings) { tl.to('.dot', settings); }`;
    expect(definitions(code, "tl.to('.dot', settings);")).toEqual([]);
  });
  it("handles aliases, spreads, destructuring and cyclic references once", () => {
    const code = `const base = {y: -15};
const {y: distance} = base;
const settings = {...base, y: distance, callback: () => alias};
const alias = settings;
tl.to('.dot', alias);`;
    const result = definitions(code, "tl.to('.dot', alias);");
    expect(result).toHaveLength(4);
    expect(new Set(result).size).toBe(4);
  });
  it("leaves parse failures unmapped", () => {
    expect(sourceDependencies("const = broken")({ start: 0, end: 14 })).toEqual([]);
  });
});
