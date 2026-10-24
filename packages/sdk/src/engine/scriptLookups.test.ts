import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { scriptLooksUp } from "./scriptLookups.js";

function doc(body: string, script: string): Document {
  return parseHTML(`<!DOCTYPE html><html><body>${body}<script>${script}</script></body></html>`)
    .document as unknown as Document;
}

const get = (d: Document, id: string): Element => d.getElementById(id) as Element;

describe("scriptLooksUp", () => {
  it("finds a getElementById lookup", () => {
    const d = doc(
      `<path id="arch-path"></path><i id="plain"></i>`,
      `document.getElementById('arch-path').getTotalLength()`,
    );
    expect(scriptLooksUp(d, get(d, "arch-path"))).toBe(true);
    expect(scriptLooksUp(d, get(d, "plain"))).toBe(false);
  });

  it("finds a querySelector('#id') lookup, also inside a selector list", () => {
    const d = doc(`<b id="a"></b><b id="b"></b>`, `document.querySelectorAll("#a, #zzz")`);
    expect(scriptLooksUp(d, get(d, "a"))).toBe(true);
    expect(scriptLooksUp(d, get(d, "b"))).toBe(false);
  });

  it("finds a node a template literal builds the id of", () => {
    const d = doc(
      `<b id="card-3-left"></b>`,
      "for (let i=1;i<4;i++) document.getElementById(`card-${i}-left`).getBoundingClientRect()",
    );
    expect(scriptLooksUp(d, get(d, "card-3-left"))).toBe(true);
  });

  it("counts a lookup of a descendant", () => {
    const d = doc(
      `<g id="dots-group"><circle id="dot"></circle></g>`,
      `document.querySelector('#dot').appendChild(x)`,
    );
    expect(scriptLooksUp(d, get(d, "dots-group"))).toBe(true);
  });

  it("does not match a longer or shorter id", () => {
    const d = doc(`<b id="arch"></b>`, `document.getElementById('arch-path')`);
    expect(scriptLooksUp(d, get(d, "arch"))).toBe(false);
  });

  it("ignores a script with a src and a document with no script lookup", () => {
    const d = parseHTML(
      `<!DOCTYPE html><html><body><b id="x"></b><script src="a.js">getElementById('x')</script></body></html>`,
    ).document as unknown as Document;
    expect(scriptLooksUp(d, get(d, "x"))).toBe(false);
  });
});
