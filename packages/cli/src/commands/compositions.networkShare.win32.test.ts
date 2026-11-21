import { beforeEach, describe, expect, it, vi } from "vitest";

// Windows path rules on any host, and a disk that records every path it is asked about.
const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  touched: [] as string[],
}));
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  const look = (path: string) => {
    disk.touched.push(String(path));
    return disk.files.get(String(path).toLowerCase());
  };
  const opened = new Map<number, string>();
  const existsSync = (path: string) => look(path) !== undefined;
  const statSync = (path: string) => {
    if (look(path) === undefined) throw missing(path);
    return { isFile: () => true, isDirectory: () => false };
  };
  const realpathSync = (path: string) => {
    if (look(path) === undefined && !/^c:\\project$/i.test(path)) throw missing(path);
    return path;
  };
  const openSync = (path: string) => {
    if (look(path) === undefined) throw missing(path);
    const fd = opened.size + 100;
    opened.set(fd, path);
    return fd;
  };
  const fstatSync = () => ({ isFile: () => true });
  const readFileSync = (target: string | number, encoding?: string) => {
    const path = typeof target === "number" ? opened.get(target)! : target;
    const text = look(path);
    if (text === undefined) throw missing(path);
    return encoding ? text : Buffer.from(text);
  };
  const closeSync = (fd: number) => opened.delete(fd);
  const overrides = {
    existsSync,
    statSync,
    realpathSync,
    openSync,
    fstatSync,
    readFileSync,
    closeSync,
  };
  return { ...fs, ...overrides, default: { ...fs, ...overrides } };
});

const { ensureDOMParser } = await import("../utils/dom.js");
const { parseCompositions } = await import("./compositions.js");
const { describeProject } = await import("../timeline/describeProject.js");

const PROJECT = "C:\\project";
const SUB = `<template><div data-composition-id="sub"><h1 data-start="0" data-duration="2">Hi</h1></div></template>`;
const SHARES = [
  "//host/share/x.html",
  "\\\\host\\share\\x.html",
  "\\\\?\\UNC\\host\\share\\x.html",
  "\\\\.\\pipe\\x.html",
];
const onShare = (path: string) => /^[\\/]{2}/.test(path);
const host = (src: string) =>
  `<div data-composition-id="main" data-duration="5">
     <div id="host" data-composition-id="sub" data-composition-src="${src}" data-start="0" data-duration="2"></div>
   </div>`;
const subOf = (found: Array<{ id: string; source?: string }>) => found.find((c) => c.id === "sub");
const timelineOf = (src: string) =>
  describeProject(
    `${PROJECT}\\index.html`,
    async () => 0,
    new Map([["index.html", `<html><body>${host(src)}</body></html>`]]),
  );

beforeEach(() => {
  ensureDOMParser();
  disk.files.clear();
  disk.touched.length = 0;
  disk.files.set("c:\\project\\scenes\\sub.html", SUB);
});

describe("sub-composition sources on another computer's share", () => {
  it.each(SHARES)("compositions never looks up %s", (src) => {
    const found = subOf(parseCompositions(host(src), PROJECT));

    expect(disk.touched.filter(onShare)).toEqual([]);
    expect(found).toBeDefined();
    expect(found?.source).toBeUndefined();
  });

  it.each(SHARES)("timeline never looks up %s", async (src) => {
    await timelineOf(src);

    expect(disk.touched.filter(onShare)).toEqual([]);
  });

  it("compositions reads no src that leaves the project", () => {
    disk.files.set("c:\\outside.html", SUB);
    for (const src of ["../outside.html", "C:\\outside.html"]) {
      const found = subOf(parseCompositions(host(src), PROJECT));
      expect(found?.source).toBeUndefined();
    }
    expect(disk.touched.filter((path) => /^c:\\outside\.html$/i.test(path))).toEqual([]);
  });

  it("still reads a sub-composition inside the project", async () => {
    const found = subOf(parseCompositions(host("scenes/sub.html"), PROJECT));
    expect(found).toMatchObject({
      id: "sub",
      source: "scenes/sub.html",
      duration: 2,
    });

    disk.touched.length = 0;
    const timeline = await timelineOf("scenes/sub.html");
    expect(timeline.tracks.flatMap((track) => track.rows).length).toBeGreaterThan(1);
    expect(disk.touched).toContain("C:\\project\\scenes\\sub.html");
  });
});
