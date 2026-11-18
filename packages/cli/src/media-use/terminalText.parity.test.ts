import { terminalText as coreTerminalText } from "@hyperframes/core";
import { expect, it } from "vitest";
import { terminalText } from "./lib/terminal-text.mjs";

it("the media-use copy of terminalText escapes every character as core's does", () => {
  for (let code = 0; code <= 0xa0; code++) {
    const text = `a${String.fromCharCode(code)}b`;
    expect(terminalText(text), `U+${code.toString(16)}`).toBe(coreTerminalText(text));
  }
});
