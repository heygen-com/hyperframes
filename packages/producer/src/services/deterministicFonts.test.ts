import { describe, expect, it } from "bun:test";
import { FONT_ALIASES, FONT_ALIAS_KEYS } from "./deterministicFonts.js";

describe("FONT_ALIASES cross-platform coverage", () => {
  it("maps macOS sans-serif system fonts to inter", () => {
    expect(FONT_ALIASES["sf pro"]).toBe("inter");
    expect(FONT_ALIASES["sf pro display"]).toBe("inter");
    expect(FONT_ALIASES["sf pro text"]).toBe("inter");
    expect(FONT_ALIASES["sf pro rounded"]).toBe("inter");
    expect(FONT_ALIASES["avenir"]).toBe("inter");
    expect(FONT_ALIASES["avenir next"]).toBe("inter");
    expect(FONT_ALIASES["geneva"]).toBe("inter");
    expect(FONT_ALIASES["optima"]).toBe("inter");
    expect(FONT_ALIASES["lucida grande"]).toBe("inter");
  });

  it("maps Windows sans-serif system fonts to inter", () => {
    expect(FONT_ALIASES["calibri"]).toBe("inter");
    expect(FONT_ALIASES["candara"]).toBe("inter");
    expect(FONT_ALIASES["corbel"]).toBe("inter");
    expect(FONT_ALIASES["verdana"]).toBe("inter");
    expect(FONT_ALIASES["tahoma"]).toBe("inter");
    expect(FONT_ALIASES["trebuchet ms"]).toBe("inter");
    expect(FONT_ALIASES["lucida sans"]).toBe("inter");
    expect(FONT_ALIASES["lucida sans unicode"]).toBe("inter");
  });

  it("maps Linux sans-serif system fonts to inter", () => {
    expect(FONT_ALIASES["noto sans"]).toBe("inter");
    expect(FONT_ALIASES["dejavu sans"]).toBe("inter");
    expect(FONT_ALIASES["liberation sans"]).toBe("inter");
  });

  it("maps monospace system fonts to jetbrains-mono", () => {
    expect(FONT_ALIASES["sf mono"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["menlo"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["monaco"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["consolas"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["lucida console"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["lucida sans typewriter"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["andale mono"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["dejavu sans mono"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["liberation mono"]).toBe("jetbrains-mono");
  });

  it("maps serif system fonts to eb-garamond", () => {
    expect(FONT_ALIASES["georgia"]).toBe("eb-garamond");
    expect(FONT_ALIASES["palatino"]).toBe("eb-garamond");
    expect(FONT_ALIASES["palatino linotype"]).toBe("eb-garamond");
    expect(FONT_ALIASES["book antiqua"]).toBe("eb-garamond");
    expect(FONT_ALIASES["cambria"]).toBe("eb-garamond");
    expect(FONT_ALIASES["times"]).toBe("eb-garamond");
    expect(FONT_ALIASES["times new roman"]).toBe("eb-garamond");
    expect(FONT_ALIASES["dejavu serif"]).toBe("eb-garamond");
    expect(FONT_ALIASES["liberation serif"]).toBe("eb-garamond");
  });

  it("preserves all existing aliases", () => {
    expect(FONT_ALIASES["helvetica neue"]).toBe("inter");
    expect(FONT_ALIASES["arial"]).toBe("inter");
    expect(FONT_ALIASES["courier new"]).toBe("jetbrains-mono");
    expect(FONT_ALIASES["segoe ui"]).toBe("roboto");
    expect(FONT_ALIASES["futura"]).toBe("montserrat");
    expect(FONT_ALIASES["bebas neue"]).toBe("league-gothic");
  });

  it("exports FONT_ALIAS_KEYS containing all alias entries", () => {
    expect(FONT_ALIAS_KEYS).toBeInstanceOf(Set);
    expect(FONT_ALIAS_KEYS.has("sf mono")).toBe(true);
    expect(FONT_ALIAS_KEYS.has("menlo")).toBe(true);
    expect(FONT_ALIAS_KEYS.has("consolas")).toBe(true);
    expect(FONT_ALIAS_KEYS.has("inter")).toBe(true);
    expect(FONT_ALIAS_KEYS.size).toBe(Object.keys(FONT_ALIASES).length);
  });
});
