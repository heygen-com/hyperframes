import { describe, expect, it } from "vitest";
import { injectPreviewVariables } from "./previewVariables";

const SCRIPT = '<script data-hf-preview-variables>window.__hfVariables={"a":1};</script>';

describe("injectPreviewVariables", () => {
  it.each([
    [
      "<!doctype html><html><head>x</head></html>",
      "<!doctype html><html><head>",
      "x</head></html>",
    ],
    [
      "<!DOCTYPE html><HTML lang='en'><HEAD id='h'>x",
      "<!DOCTYPE html><HTML lang='en'><HEAD id='h'>",
      "x",
    ],
    ["<!doctype html><html lang='en'>x", "<!doctype html><html lang='en'>", "x"],
    [" \n<!DOCTYPE html>x", " \n<!DOCTYPE html>", "x"],
    ["fragment", "", "fragment"],
    ["x<!doctype html>y", "", "x<!doctype html>y"],
    ["<headless>x", "<headless>", "x"],
    ["<head attr='>'>x", "<head attr='>", "'>x"],
    ["<html><head", "<html>", "<head"],
    ["<head<head>x", "<head<head>", "x"],
  ])("preserves insertion boundaries (case %#)", (html, before, after) => {
    expect(injectPreviewVariables(html, { a: 1 })).toBe(before + SCRIPT + after);
  });

  it.each(["<head", "<html"])("handles repeated unterminated %s prefixes", (prefix) => {
    const malformed = prefix.repeat(20_000);
    expect(injectPreviewVariables(malformed, { a: 1 })).toBe(SCRIPT + malformed);
    expect(injectPreviewVariables(malformed + ">tail", { a: 1 })).toBe(
      malformed + ">" + SCRIPT + "tail",
    );
  });

  it("escapes script-breaking input before inserting it", () => {
    expect(injectPreviewVariables("<head>", { a: "</script>" })).toBe(
      '<head><script data-hf-preview-variables>window.__hfVariables={"a":"\\u003c/script>"};</script>',
    );
  });
});
