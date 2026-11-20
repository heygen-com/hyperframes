import { afterEach, describe, expect, it } from "vitest";
import { handleFor } from "../editingHandles";
import { editElement, MAX_EDIT_ENTRIES, MAX_EDIT_VALUE, parseEditElement } from "./editElement";

afterEach(() => {
  document.body.innerHTML = "";
});

const HANDLE = "0123456789abcdef:1";

describe("edit-element", () => {
  it("takes a handle with bounded style and attribute entries", () => {
    const params = { handle: HANDLE, styles: [["opacity", "0.5"]], attributes: [["title", null]] };
    expect(parseEditElement(params)).toEqual(params);
    expect(parseEditElement({ ...params, extra: 1 })).toBeNull();
    expect(parseEditElement({ ...params, styles: [["opacity;", "1"]] })).toBeNull();
    expect(
      parseEditElement({ ...params, styles: [["color", "x".repeat(MAX_EDIT_VALUE + 1)]] }),
    ).toBeNull();
  });

  it("takes vendor-prefixed styles and an important marker, and no more entries than the bound", () => {
    const style = (entry: unknown[]) => ({ handle: HANDLE, styles: [entry], attributes: [] });
    expect(parseEditElement(style(["-webkit-mask-image", "none"]))).not.toBeNull();
    expect(parseEditElement(style(["color", "red", "important"]))).not.toBeNull();
    expect(parseEditElement(style(["color", "red", "urgent"]))).toBeNull();
    const many = Array.from({ length: MAX_EDIT_ENTRIES + 1 }, (_, i) => [`data-n${i}`, "1"]);
    expect(parseEditElement({ handle: HANDLE, styles: [], attributes: many })).toBeNull();
    expect(
      parseEditElement({ handle: HANDLE, styles: [], attributes: many.slice(1) }),
    ).not.toBeNull();
  });

  it("takes only the attributes the property panel writes", () => {
    const attribute = (name: string) =>
      parseEditElement({ handle: HANDLE, styles: [], attributes: [[name, "x"]] });
    for (const name of ["data-volume", "loop", "muted", "alt", "title", "src"])
      expect(attribute(name), name).not.toBeNull();
    for (const name of ["href", "srcdoc", "xlink:href", "action", "formaction", "style", "class"])
      expect(attribute(name), name).toBeNull();
  });

  it("refuses event handler attributes", () => {
    const params = { handle: HANDLE, styles: [], attributes: [["onclick", "alert(1)"]] };
    expect(parseEditElement(params)).toBeNull();
    expect(parseEditElement({ ...params, attributes: [["ONLOAD", "x"]] })).toBeNull();
  });

  it("draws styles and attributes and answers what they held before", () => {
    document.body.innerHTML = `<div id="card" style="color: red" data-volume="1"></div>`;
    const card = document.getElementById("card")!;
    const result = editElement({
      handle: handleFor(card),
      styles: [
        ["color", "blue"],
        ["opacity", "0.5"],
      ],
      attributes: [
        ["data-volume", null],
        ["title", "Card"],
      ],
    });
    expect(result).toEqual({
      applied: true,
      styles: [
        ["color", "red"],
        ["opacity", null],
      ],
      attributes: [
        ["data-volume", "1"],
        ["title", null],
      ],
    });
    expect(card.style.color).toBe("blue");
    expect(card.style.opacity).toBe("0.5");
    expect(card.hasAttribute("data-volume")).toBe(false);
    expect(card.getAttribute("title")).toBe("Card");
  });

  it("sets a src only on media", () => {
    document.body.innerHTML = `<div id="box"></div><img id="pic" src="a.png" />`;
    const box = document.getElementById("box")!;
    const pic = document.getElementById("pic")!;
    const src = (el: Element) =>
      editElement({ handle: handleFor(el), styles: [], attributes: [["src", "b.png"]] });
    expect(src(box).applied).toBe(false);
    expect(box.hasAttribute("src")).toBe(false);
    expect(src(pic)).toEqual({ applied: true, styles: [], attributes: [["src", "a.png"]] });
    expect(pic.getAttribute("src")).toBe("b.png");
  });

  it("answers an important style with its priority, so putting it back keeps it", () => {
    document.body.innerHTML = `<div id="card" style="color: red !important"></div>`;
    const card = document.getElementById("card")!;
    const handle = handleFor(card);
    const { styles } = editElement({ handle, styles: [["color", "blue"]], attributes: [] });
    expect(styles).toEqual([["color", "red", "important"]]);
    editElement({ handle, styles, attributes: [] });
    expect(card.style.getPropertyValue("color")).toBe("red");
    expect(card.style.getPropertyPriority("color")).toBe("important");
  });

  it("draws nothing whose old value is too long to send back", () => {
    document.body.innerHTML = `<div id="card"></div>`;
    const card = document.getElementById("card")!;
    card.setAttribute("data-fx", "x".repeat(MAX_EDIT_VALUE + 1));
    const result = editElement({
      handle: handleFor(card),
      styles: [["color", "blue"]],
      attributes: [["data-fx", "short"]],
    });
    expect(result.applied).toBe(false);
    expect(card.style.color).toBe("");
    expect(card.getAttribute("data-fx")).toHaveLength(MAX_EDIT_VALUE + 1);
  });

  it("draws text markup and answers the markup it replaced", () => {
    document.body.innerHTML = `<h1 id="t">Old <span class="a">bit</span></h1>`;
    const title = document.getElementById("t")!;
    const html = 'New <span class="a" style="color: red">bit</span>';
    const result = editElement({ handle: handleFor(title), styles: [], attributes: [], html });
    expect(result).toEqual({
      applied: true,
      styles: [],
      attributes: [],
      html: 'Old <span class="a">bit</span>',
    });
    expect(title.innerHTML).toBe(html);
  });

  it("draws no markup beyond inline text, and none over markup it could not put back", () => {
    document.body.innerHTML = `<h1 id="t">Old</h1><div id="d"><img src="a.png" /></div>`;
    const draw = (id: string, html: string) =>
      editElement({
        handle: handleFor(document.getElementById(id)!),
        styles: [],
        attributes: [],
        html,
      }).applied;
    for (const html of ['<img src="x">', '<a href="x">x</a>', '<span onclick="x">x</span>'])
      expect(draw("t", html), html).toBe(false);
    expect(document.getElementById("t")!.innerHTML).toBe("Old");
    expect(draw("d", "text")).toBe(false);
    expect(parseEditElement({ handle: HANDLE, styles: [], attributes: [], html: 1 })).toBeNull();
  });

  it("applies nothing for a handle the page no longer has", () => {
    expect(editElement({ handle: HANDLE, styles: [["color", "blue"]], attributes: [] })).toEqual({
      applied: false,
      styles: [],
      attributes: [],
    });
  });
});
