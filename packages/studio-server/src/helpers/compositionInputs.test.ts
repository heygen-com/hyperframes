import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compositionInputSignature, compositionsAffectedBy } from "./compositionInputs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-composition-inputs-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const mount = (src: string) => `<div data-composition-src="${src}"></div>`;

describe("compositionsAffectedBy", () => {
  const dir = () =>
    project({
      "index.html": mount("compositions/a.html") + mount("./compositions/b.html"),
      "compositions/a.html": `<template>${mount("compositions/nested.html")}</template>`,
      "compositions/b.html": "<template>b</template>",
      "compositions/nested.html": "<template>nested</template>",
      "compositions/unmounted.html": "<template>draft</template>",
      "assets/logo.svg": "<svg/>",
    });

  it("names a scene and the compositions that mount it, not its siblings", () => {
    expect(compositionsAffectedBy(dir(), "compositions/b.html")).toEqual([
      "index.html",
      "compositions/b.html",
    ]);
    expect(compositionsAffectedBy(dir(), "compositions/nested.html")).toEqual([
      "index.html",
      "compositions/a.html",
      "compositions/nested.html",
    ]);
  });

  it("reaches every composition from an asset or a file the root does not mount", () => {
    expect(compositionsAffectedBy(dir(), "assets/logo.svg")).toBeNull();
    expect(compositionsAffectedBy(dir(), "compositions/unmounted.html")).toBeNull();
  });

  it("reads watcher paths with either separator", () => {
    expect(compositionsAffectedBy(dir(), "compositions\\b.html")).toEqual([
      "index.html",
      "compositions/b.html",
    ]);
  });
});

describe("a root write", () => {
  const html = (head: string, body: string) =>
    `<html><head>${head}</head><body>${body}${mount("compositions/a.html")}</body></html>`;
  const files = (head: string, body: string) => ({
    "index.html": html(head, body),
    "compositions/a.html": "<template>a</template>",
  });
  const rewrite = (dir: string, head: string, body: string) =>
    writeFileSync(join(dir, "index.html"), html(head, body));

  it("moves every composition when the head changed, or when no head was seen yet", () => {
    const dir = project(files("<style>a{}</style>", "x"));
    expect(compositionsAffectedBy(dir, "index.html")).toBeNull();

    compositionInputSignature(dir, "compositions/a.html", "s1");
    rewrite(dir, "<style>b{}</style>", "x");
    expect(compositionsAffectedBy(dir, "index.html")).toBeNull();
  });

  it("moves only the root when the head is as it was", () => {
    const dir = project(files("<style>a{}</style>", "x"));
    compositionInputSignature(dir, "compositions/a.html", "s1");
    rewrite(dir, "<style>a{}</style>", "moved");
    expect(compositionsAffectedBy(dir, "index.html")).toEqual(["index.html"]);
    rewrite(dir, "<style>a{}</style>", "moved again");
    expect(compositionsAffectedBy(dir, "index.html")).toEqual(["index.html"]);
  });

  it("tells every subscriber of one head edit the same thing, even after a thumbnail request", () => {
    const dir = project(files("<style>a{}</style>", "x"));
    compositionInputSignature(dir, "compositions/a.html", "s1");
    rewrite(dir, "<style>b{}</style>", "x");
    expect(compositionsAffectedBy(dir, "index.html")).toBeNull();
    compositionInputSignature(dir, "compositions/a.html", "s2");
    expect(compositionsAffectedBy(dir, "index.html")).toBeNull();
  });

  it("leaves a scene's input signature alone for a body edit, not for a head edit", () => {
    const dir = project(files("<style>a{}</style>", "x"));
    const before = compositionInputSignature(dir, "compositions/a.html", "s1");
    rewrite(dir, "<style>a{}</style>", "moved");
    expect(compositionInputSignature(dir, "compositions/a.html", "s2")).toBe(before);
    rewrite(dir, "<style>b{}</style>", "moved");
    expect(compositionInputSignature(dir, "compositions/a.html", "s3")).not.toBe(before);
  });

  it("changes the root's own input signature for a body edit", () => {
    const dir = project(files("<style>a{}</style>", "x"));
    const before = compositionInputSignature(dir, "index.html", "s1");
    rewrite(dir, "<style>a{}</style>", "moved");
    expect(compositionInputSignature(dir, "index.html", "s2")).not.toBe(before);
  });
});
