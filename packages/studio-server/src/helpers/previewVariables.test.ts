import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
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
    ["<html><head", "<html>", "<head"],
    ["<head attr='>'>x", "<head attr='>'>", "x"],
    ['<html a="<head>"><head>x', '<html a="<head>"><head>', "x"],
    ["<html a='<head>' b=<head><body>x", "<html a='<head>' b=<head>", "<body>x"],
    ["<html a = '>' / b><head>x", "<html a = '>' / b><head>", "x"],
    [
      "<!-- <head> --><!doctype html><html><head>x",
      "<!-- <head> --><!doctype html><html><head>",
      "x",
    ],
    ["<!doctype html><!-- <head> --><body>x", "<!doctype html>", "<!-- <head> --><body>x"],
    ["<!--><html a='--><head>'><head>x", "<!--><html a='--><head>'><head>", "x"],
    ["<!--!><head>--><head>x", "<!--!><head>--><head>", "x"],
    ["<!-- a --!><head>x", "<!-- a --!><head>", "x"],
    ["<!---!><head>--><head>x", "<!---!><head>--><head>", "x"],
    ["<!---><head>x", "<!---><head>", "x"],
    ["<!-- <head> never closed", "", "<!-- <head> never closed"],
    ["<?xml version='1.0'?><html><head>x", "<?xml version='1.0'?><html><head>", "x"],
    ["\uFEFF<!doctype html><head>x", "\uFEFF<!doctype html><head>", "x"],
    ['<html a="<head>x', "", '<html a="<head>x'],
    ['<html ="<head>"><head>x', '<html ="<head>', '"><head>x'],
    ["<headless>x", "", "<headless>x"],
    ["<head<head>x", "", "<head<head>x"],
    ["<html><body><head>x", "<html>", "<body><head>x"],
    ["<html>text<head>x", "<html>", "text<head>x"],
    ["<title><head></title>x", "", "<title><head></title>x"],
  ])("preserves insertion boundaries (case %#)", (html, before, after) => {
    expect(injectPreviewVariables(html, { a: 1 })).toBe(before + SCRIPT + after);
  });

  it.each(["<head", "<html"])("handles repeated unterminated %s prefixes", (prefix) => {
    const malformed = prefix.repeat(20_000);
    expect(injectPreviewVariables(malformed, { a: 1 })).toBe(SCRIPT + malformed);
    expect(injectPreviewVariables(malformed + ">tail", { a: 1 })).toBe(
      SCRIPT + malformed + ">tail",
    );
  });

  it.each([
    [
      "an attribute of <html> holds <head> and <header> text",
      `<!doctype html><html lang="en" data-composition-variables='[{"label":"Page <header> and <head> text"}]'><head><title>t</title></head><body></body></html>`,
    ],
    [
      "a leading comment holds <head>",
      `<!-- the <head> goes below --><!doctype html><html lang="en" data-x="1"><head><title>t</title></head><body></body></html>`,
    ],
  ])("puts one script in <head> and leaves <html> as written when %s", (_name, html) => {
    const before = parseHTML(html).document;
    const { document } = parseHTML(
      injectPreviewVariables(html, { x: '" onpointermove="1', y: "' onclick='1", z: "-->" }),
    );
    const scripts = document.querySelectorAll("script[data-hf-preview-variables]");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.parentElement).toBe(document.head);
    expect(document.head.firstElementChild).toBe(scripts[0]);
    expect(document.documentElement.getAttributeNames()).toEqual(
      before.documentElement.getAttributeNames(),
    );
    expect(document.documentElement.getAttribute("data-composition-variables")).toBe(
      before.documentElement.getAttribute("data-composition-variables"),
    );
  });

  it("escapes script-breaking input before inserting it", () => {
    expect(injectPreviewVariables("<head>", { a: "</script>" })).toBe(
      '<head><script data-hf-preview-variables>window.__hfVariables={"a":"\\u003c/script>"};</script>',
    );
  });
});
