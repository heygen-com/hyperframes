import { describe, expect, it, vi } from "vitest";

// Windows path rules on any host, and a disk that records every path it is asked about.
const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  touched: [] as string[],
  open: new Map<number, string>(),
}));
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
// file: URLs read as Windows reads them: file://host/share/x is \\host\share\x.
vi.mock("node:url", async () => {
  const url = await vi.importActual<typeof import("node:url")>("node:url");
  const fileURLToPath = (href: string | URL) => url.fileURLToPath(href, { windows: true });
  return { ...url, fileURLToPath, default: { ...url, fileURLToPath } };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  const look = (path: string) => {
    disk.touched.push(path);
    return disk.files.get(path.toLowerCase());
  };
  const statSync = (path: string, options?: { throwIfNoEntry?: boolean }) => {
    const text = look(path);
    if (text === undefined && options?.throwIfNoEntry === false) return undefined;
    if (text === undefined) throw missing(path);
    return {
      isFile: () => true,
      isDirectory: () => false,
      size: text.length,
      dev: 1n,
      ino: 1n,
    };
  };
  const existsSync = (path: string) => look(path) !== undefined;
  const realpathSync = Object.assign((path: string) => (disk.touched.push(path), path), {
    native: (path: string) => (disk.touched.push(path), path),
  });
  const openSync = (path: string) => {
    if (look(path) === undefined) throw missing(path);
    const fd = disk.open.size + 100;
    disk.open.set(fd, path);
    return fd;
  };
  const readSync = (fd: number, buffer: Buffer, offset: number, length: number) =>
    Buffer.from(disk.files.get(disk.open.get(fd)!.toLowerCase())!).copy(buffer, offset, 0, length);
  const closeSync = (fd: number) => disk.open.delete(fd);
  const overrides = {
    statSync,
    existsSync,
    realpathSync,
    openSync,
    readSync,
    closeSync,
  };
  return { ...fs, ...overrides, default: { ...fs, ...overrides } };
});
// The record says index.html came from someone else; deciding where a file leads would realpath it.
vi.mock("./privateProjectFile.js", async () => {
  const { win32 } = await vi.importActual<typeof import("node:path")>("node:path");
  return {
    receivedRecordStatus: (projectDir: string) => ({
      path: win32.join(projectDir, ".hyperframes", "received-files.json"),
      listed: [win32.join(projectDir, "index.html")],
    }),
    linksOutside: (projectDir: string, path: string) => {
      disk.touched.push(path);
      const rel = win32.relative(projectDir, path);
      return rel.startsWith("..") || win32.isAbsolute(rel);
    },
  };
});

const { outsideAssetsAllowed } = await import("./receivedRender.js");

const SHARES = [
  "\\\\host\\share\\a.png",
  "/\\host\\share\\b.png",
  "\\/host/share/c.png",
  "\\\\?\\UNC\\host\\share\\d.png",
  "\\\\.\\pipe\\e",
  "\\\\.\\UNC\\host\\share\\j.png",
  "\\\\?\\D:\\media\\f.png",
  "file://host/share/g.png",
  "%5C%5Chost%5Cshare%5Ch.png",
  "\\\\host\\share\\i.png?v=2",
];
const onAShare = (path: string) => /^[\\/]{2}/.test(path);

function decide(project: string, html: string, css = "") {
  disk.files.clear();
  disk.touched.length = 0;
  disk.files.set(`${project}\\index.html`.toLowerCase(), html);
  disk.files.set(`${project}\\style.css`.toLowerCase(), css);
  disk.files.set("d:\\media\\pic.png", "png");
  for (const share of ["\\\\host\\share\\a.png", "\\\\host\\share\\x.css"]) {
    disk.files.set(share.toLowerCase(), "x");
  }
  const warn = vi.fn();
  const allowed = outsideAssetsAllowed(project, undefined, warn);
  return { allowed, line: String(warn.mock.calls[0]?.[0] ?? "") };
}

describe("outsideAssetsAllowed under Windows rules", () => {
  const PROJECT = "C:\\project";
  const html =
    `<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="\\\\host\\share\\x.css">` +
    SHARES.map((src) => `<img src="${src}">`).join("") +
    `<div data-composition-src="\\\\host\\share\\scene.html"></div>` +
    `<div data-composition-src="file://host/share/scene.html"></div>` +
    `<img src="D:\\media\\pic.png">`;
  const css = `body { background: url(\\\\host\\share\\bg.png) }`;

  it("never looks at another computer's share or a device path, however it is written", () => {
    const { allowed } = decide(PROJECT, html, css);
    expect(allowed).toBe(false);
    expect(disk.touched.filter(onAShare)).toEqual([]);
  });

  it("still names those references and a local file outside the project in the notice", () => {
    const { line } = decide(PROJECT, html, css);
    for (const ref of [...SHARES, "\\\\host\\share\\x.css", "\\\\host\\share\\bg.png"]) {
      expect(line).toContain(ref);
    }
    expect(line).toContain("D:\\media\\pic.png");
    expect(disk.touched).toContain("D:\\media\\pic.png");
  });

  it("still checks a file on the share the project itself lives on", () => {
    const project = "\\\\nas\\films\\project";
    const { line } = decide(project, `<img src="\\\\NAS\\films\\shared\\pic.png">`);
    expect(line).toBe("");
    expect(disk.touched).toContain("\\\\NAS\\films\\shared\\pic.png");
  });
});
