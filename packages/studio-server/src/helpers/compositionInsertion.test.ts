import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { CompositionInsertionError, insertCompositionIntoSource } from "./compositionInsertion";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-comp-insert-"));
  dirs.push(dir);
  return dir;
}

const parent = `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-duration="6"><div id="occupied" data-start="1" data-duration="5" data-track-index="2"></div></div></body></html>`;
const child = `<template><div data-composition-id="headline" data-width="1920" data-height="1080" data-duration="4.9"><h1>Title</h1></div></template>`;

function writeFixture(dir: string): void {
  writeFileSync(join(dir, "index.html"), parent);
  writeFileSync(join(dir, "headline.html"), child);
}

describe("insertCompositionIntoSource", () => {
  it("inserts template-root compositions with stable timing and spills a collision", () => {
    const dir = project();
    writeFixture(dir);

    const result = insertCompositionIntoSource({
      projectDir: dir,
      targetPath: "index.html",
      sourcePath: "headline.html",
      parentSource: parent,
      start: 2,
      desiredTrack: 2,
    });
    const host = parseHTML(result.html).document.getElementById(result.hostId);

    expect(result.track).toBe(3);
    expect(host?.getAttribute("data-composition-src")).toBe("headline.html");
    expect(host?.getAttribute("data-playback-start")).toBe("0");
    expect(host?.getAttribute("data-duration")).toBe("4.9");
    expect(host?.getAttribute("data-hf-id")).toMatch(/^hf-/);
    expect(result.html).toContain('data-duration="6.9"');
  });

  it("gives repeated sources distinct host identities", () => {
    const dir = project();
    writeFixture(dir);
    const first = insertCompositionIntoSource({
      projectDir: dir,
      targetPath: "index.html",
      sourcePath: "headline.html",
      parentSource: parent,
      start: 0,
      desiredTrack: 0,
    });
    writeFileSync(join(dir, "index.html"), first.html);
    const second = insertCompositionIntoSource({
      projectDir: dir,
      targetPath: "index.html",
      sourcePath: "headline.html",
      parentSource: first.html,
      start: 5,
      desiredTrack: 0,
    });

    expect(second.hostId).not.toBe(first.hostId);
    expect(second.html.match(/data-composition-src="headline.html"/g)).toHaveLength(2);
  });

  it("reserves existing composition identities even when host ids are missing", () => {
    const dir = project();
    const existingParent = `<!doctype html><html><body>
      <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="6">
        <div data-composition-id="headline" data-composition-src="headline.html" data-start="0" data-duration="1" data-track-index="0"></div>
      </div>
    </body></html>`;
    writeFileSync(join(dir, "index.html"), existingParent);
    writeFileSync(join(dir, "headline.html"), child);

    const result = insertCompositionIntoSource({
      projectDir: dir,
      targetPath: "index.html",
      sourcePath: "headline.html",
      parentSource: existingParent,
      start: 2,
      desiredTrack: 0,
    });
    const document = parseHTML(result.html).document;
    const ids = Array.from(document.querySelectorAll("[data-composition-id]")).map((element) =>
      element.getAttribute("data-composition-id"),
    );

    expect(result.hostId).toBe("headline_2");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores nested composition internals when resolving a parent track collision", () => {
    const dir = project();
    const inlineParent = `<!doctype html><html><body>
      <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="6">
        <div data-composition-id="nested" data-composition-src="nested.html" data-start="0" data-duration="6" data-track-index="0">
          <div data-start="2" data-duration="3" data-track-index="2"></div>
        </div>
      </div>
    </body></html>`;
    writeFileSync(join(dir, "index.html"), inlineParent);
    writeFileSync(join(dir, "headline.html"), child);

    const result = insertCompositionIntoSource({
      projectDir: dir,
      targetPath: "index.html",
      sourcePath: "headline.html",
      parentSource: inlineParent,
      start: 2,
      desiredTrack: 2,
    });

    expect(result.track).toBe(2);
  });

  it("inserts into a template-root parent composition", () => {
    const dir = project();
    const templateParent = `<template><div data-composition-id="parent" data-width="1920" data-height="1080" data-duration="2"></div></template>`;
    writeFileSync(join(dir, "parent.html"), templateParent);
    writeFileSync(join(dir, "headline.html"), child);

    const result = insertCompositionIntoSource({
      projectDir: dir,
      targetPath: "parent.html",
      sourcePath: "headline.html",
      parentSource: templateParent,
      start: 1,
      desiredTrack: 0,
    });

    expect(result.html).toContain('data-composition-src="headline.html"');
    expect(result.html).toContain('data-duration="5.9"');
  });

  it("rejects self-nesting, transitive cycles, missing files, and invalid durations", () => {
    const dir = project();
    writeFixture(dir);
    writeFileSync(
      join(dir, "middle.html"),
      `<div data-composition-id="middle" data-width="1" data-height="1" data-duration="1"><div data-composition-src="index.html"></div></div>`,
    );
    writeFileSync(
      join(dir, "cycle-source.html"),
      `<div data-composition-id="cycle" data-width="1" data-height="1" data-duration="1"><div data-composition-src="middle.html"></div></div>`,
    );
    writeFileSync(
      join(dir, "invalid.html"),
      `<div data-composition-id="invalid" data-width="1" data-height="1" data-duration="0"></div>`,
    );
    const insert = (sourcePath: string) =>
      insertCompositionIntoSource({
        projectDir: dir,
        targetPath: "index.html",
        sourcePath,
        parentSource: parent,
        start: 0,
        desiredTrack: 0,
      });

    expect(() => insert("index.html")).toThrow(/cycle/);
    expect(() => insert("cycle-source.html")).toThrow(/cycle/);
    expect(() => insert("missing.html")).toThrow(CompositionInsertionError);
    expect(() => insert("invalid.html")).toThrow(/valid data-composition-duration/);
    expect(() => insert("../outside.html")).toThrow(CompositionInsertionError);
  });
});
