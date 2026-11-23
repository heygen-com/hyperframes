import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inlineGsap, inlineGsapInProject } from "./ci/inline-gsap.mjs";

const TAG = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>';

test("a GSAP CDN tag becomes the script itself and other tags stay", () => {
  const html = `<head>${TAG}<script src="https://example.com/other.js"></script></head>`;
  const out = inlineGsap(html, "var gsap=1;");
  assert.equal(
    out,
    '<head><script>var gsap=1;</script><script src="https://example.com/other.js"></script></head>',
  );
});

test("every html file of a project is rewritten, and a project with no tag fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "inline-gsap-"));
  try {
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), `<body>${TAG}</body>`);
    writeFileSync(join(dir, "compositions", "a.html"), `<template>${TAG}</template>`);
    assert.equal(inlineGsapInProject(dir, "G;"), 2);
    assert.equal(readFileSync(join(dir, "index.html"), "utf8"), "<body><script>G;</script></body>");
    assert.throws(() => inlineGsapInProject(dir, "G;"), /no GSAP CDN script tag/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
