import { afterEach, describe, expect, it } from "vitest";
import { getSvgSelectorAliasesScript } from "./svg-selector-aliases-inline";

const nativeQuerySelector = Element.prototype.querySelector;
const renamedUse = `<symbol id="scene--icon"/><use href="#scene--icon" data-hf-svg-reference-aliases='[{"name":"href","localName":"href","namespaceURI":null,"before":"#icon","after":"#scene--icon"}]'/>`;

afterEach(() => {
  Element.prototype.querySelector = nativeQuerySelector;
  delete window.__hfSvgSelectorAliases;
});

describe("getSvgSelectorAliasesScript", () => {
  it("installs aliases that follow a renamed SVG reference", () => {
    document.body.innerHTML = `<svg>${renamedUse}</svg>`;
    new Function(getSvgSelectorAliasesScript())();
    expect(document.body.querySelector('use[href="#icon"]')).toBe(document.querySelector("use"));
  });

  it("skips malformed alias attributes from authored HTML", () => {
    const wrongType = `[{"name":1,"localName":"href","namespaceURI":null,"before":"#icon","after":"#x"}]`;
    document.body.innerHTML = `<svg><g data-hf-svg-reference-aliases="not json"/><g data-hf-svg-reference-aliases='${wrongType}'/>${renamedUse}</svg>`;
    new Function(getSvgSelectorAliasesScript())();
    expect(document.body.querySelector('use[href="#icon"]')).toBe(document.querySelector("use"));
  });
});
