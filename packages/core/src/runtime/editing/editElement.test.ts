import { afterEach, describe, expect, it } from "vitest";
import { handleFor } from "../editingHandles";
import { editElement, MAX_EDIT_VALUE, parseEditElement } from "./editElement";

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

  it("applies nothing for a handle the page no longer has", () => {
    expect(editElement({ handle: HANDLE, styles: [["color", "blue"]], attributes: [] })).toEqual({
      applied: false,
      styles: [],
      attributes: [],
    });
  });
});
