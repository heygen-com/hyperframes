import { afterEach, describe, expect, it } from "vitest";
import { readElementSource } from "./editingElement";

const mount = (html: string) => {
  document.body.innerHTML = html;
  return document.getElementById("target")!;
};

// fails without the fix: an authored data-composition-src chose the file an element's edits are written to
describe("readElementSource", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the file its host was stamped with under an empty authored data-composition-src", () => {
    const el = mount(
      `<div data-composition-file="compositions/scene.html"><div data-composition-src=""><p id="target">x</p></div></div>`,
    );
    expect(readElementSource(el).file).toBe("compositions/scene.html");
  });

  it("keeps the stamped file under an authored data-composition-src naming another project file", () => {
    const el = mount(
      `<div data-composition-file="compositions/scene.html"><div data-composition-src="index.html"><p id="target">x</p></div></div>`,
    );
    expect(readElementSource(el).file).toBe("compositions/scene.html");
  });

  it("names no file for an element under only authored data-composition-src markup", () => {
    const el = mount(`<div data-composition-src="index.html"><p id="target">x</p></div>`);
    expect(readElementSource(el).file).toBeNull();
  });

  it("reads the stamped file of the nearest mounted host", () => {
    const el = mount(
      `<div data-composition-file="index.html"><div data-composition-file="compositions/a.html"><p id="target">x</p></div></div>`,
    );
    expect(readElementSource(el).file).toBe("compositions/a.html");
  });
});
