import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkRegistryMarkupWrites,
  findMarkupWriteGrowth,
  markupWrites,
} from "./check-registry-innerhtml.mjs";

describe("registry markup-write check", () => {
  it("counts markup writes only in files that read variables", () => {
    const writes = [
      "a.innerHTML = x;",
      "b.innerHTML += y;",
      "c.outerHTML =\n  z;",
      "d.insertAdjacentHTML('beforeend', w);",
      "document.write(v);",
    ].join("\n");
    assert.equal(markupWrites(`const v = window.__hyperframes.getVariables();\n${writes}`), 5);
    assert.equal(markupWrites(`const v = window.__hfVariables || {};\n${writes}`), 5);
    assert.equal(markupWrites(writes), 0);
  });

  it("does not count reads, comparisons or textContent", () => {
    const source = [
      "const v = getVariables();",
      "if (a.innerHTML === b) log(a.innerHTML);",
      "a.textContent = v.title;",
    ].join("\n");
    assert.equal(markupWrites(source), 0);
  });

  it("fails a new file that writes markup, and a listed file whose writes grew", () => {
    const baseline = new Map([["registry/blocks/old/old.html", 2]]);
    const counts = new Map([
      ["registry/blocks/old/old.html", 3],
      ["registry/blocks/new/new.html", 1],
      ["registry/blocks/clean/clean.html", 0],
    ]);
    assert.deepEqual(findMarkupWriteGrowth(counts, baseline), [
      { path: "registry/blocks/new/new.html", count: 1, allowed: 0 },
      { path: "registry/blocks/old/old.html", count: 3, allowed: 2 },
    ]);
  });

  it("passes a listed file that kept or lost writes", () => {
    const baseline = new Map([["registry/blocks/old/old.html", 2]]);
    assert.deepEqual(
      findMarkupWriteGrowth(new Map([["registry/blocks/old/old.html", 1]]), baseline),
      [],
    );
  });

  it("passes this repository as it stands", () => {
    assert.deepEqual(checkRegistryMarkupWrites(join(import.meta.dirname, "..")), []);
  });
});
