import { afterEach, describe, expect, it } from "vitest";
import { MAX_ELEMENT_VALUE } from "../editingElement";
import { handleFor } from "../editingHandles";
import { MAX_FONT_FACES, authoredStyles, fontFaces } from "./textStyleReads";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function page(css: string, body: string) {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = body;
  return (id: string) => handleFor(document.getElementById(id)!);
}

describe("authored-styles", () => {
  it("reads the inline value first, else the last same-origin rule that matches", () => {
    const handle = page(
      `h1 { font-size: 3rem; } .title { font-size: 48px; color: red; } p { font-size: 9px; }`,
      `<h1 id="t" class="title" style="color: blue">Hi</h1><h1 id="u">Yo</h1>`,
    );
    expect(
      authoredStyles({ handle: handle("t"), properties: ["font-size", "color", "letter-spacing"] }),
    ).toEqual({ styles: { "font-size": "48px", color: "blue" } });
    expect(authoredStyles({ handle: handle("u"), properties: ["font-size"] })).toEqual({
      styles: { "font-size": "3rem" },
    });
  });

  it("skips a rule whose selector this engine cannot read", () => {
    const handle = page(
      `h1 { font-size: 2em; } h1:not-a-pseudo { font-size: 1px; }`,
      `<h1 id="t">Hi</h1>`,
    );
    expect(authoredStyles({ handle: handle("t"), properties: ["font-size"] })).toEqual({
      styles: { "font-size": "2em" },
    });
  });

  it("answers null for a handle of an element already gone", () => {
    const handle = page(`h1 { font-size: 2em; }`, `<h1 id="t">Hi</h1>`);
    const gone = handle("t");
    document.getElementById("t")!.remove();
    expect(authoredStyles({ handle: gone, properties: ["font-size"] })).toEqual({ styles: null });
  });

  it("cuts a value at the element value limit", () => {
    const long = `"${"a".repeat(MAX_ELEMENT_VALUE + 50)}"`;
    const handle = page(``, `<h1 id="t">Hi</h1>`);
    document.getElementById("t")!.style.setProperty("font-family", long);
    const { styles } = authoredStyles({ handle: handle("t"), properties: ["font-family"] });
    expect(styles?.["font-family"]).toHaveLength(MAX_ELEMENT_VALUE);
  });
});

describe("font-faces", () => {
  it("lists each same-origin @font-face rule's family", () => {
    page(
      `@font-face { font-family: "Brand Sans"; src: url("fonts/brand.woff2"); }
       h1 { font-family: "Brand Sans"; }
       @font-face { font-family: Inter; src: url("https://fonts.gstatic.com/inter.woff2"); }`,
      ``,
    );
    expect(fontFaces().ownFaces.map(({ family }) => family)).toEqual(['"Brand Sans"', "Inter"]);
  });

  it(`lists at most ${MAX_FONT_FACES} faces`, () => {
    const faces = Array.from(
      { length: MAX_FONT_FACES + 5 },
      (_, i) => `@font-face { font-family: F${i}; src: url("f${i}.woff2"); }`,
    );
    page(faces.join("\n"), ``);
    expect(fontFaces().ownFaces).toHaveLength(MAX_FONT_FACES);
  });
});
