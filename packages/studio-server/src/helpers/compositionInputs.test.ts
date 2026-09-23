import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compositionsAffectedBy } from "./compositionInputs";

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

  it("reaches every composition from the root, an asset, or a file the root does not mount", () => {
    expect(compositionsAffectedBy(dir(), "index.html")).toBeNull();
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
