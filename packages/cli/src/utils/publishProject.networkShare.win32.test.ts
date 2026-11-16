import { describe, expect, it, vi } from "vitest";

// Windows path rules on any host, and a disk that records every path it is asked about.
const disk = vi.hoisted(() => ({
  files: new Map<string, { path: string; text: string }>(),
  touched: [] as { op: string; path: string }[],
  open: new Map<number, string>(),
}));
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  const look = (op: string, path: string) => {
    disk.touched.push({ op, path });
    return disk.files.get(path.toLowerCase());
  };
  const found = (op: string, path: string) => {
    const file = look(op, path);
    if (file === undefined) throw missing(path);
    return file;
  };
  const inode = (path: string) => [...disk.files.keys()].indexOf(path.toLowerCase()) + 1;
  const fileStat = (text: string, path: string) => ({
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    size: text.length,
    mtimeMs: 0,
    dev: 1n,
    ino: BigInt(inode(path)),
  });
  const statSync = (path: string, options?: { throwIfNoEntry?: boolean }) => {
    const file = look("stat", path);
    if (file === undefined && options?.throwIfNoEntry === false) return undefined;
    if (file === undefined) throw missing(path);
    return fileStat(file.text, path);
  };
  const lstatSync = (path: string, options?: { throwIfNoEntry?: boolean }) => {
    const file = look("lstat", path);
    if (file === undefined && options?.throwIfNoEntry === false) return undefined;
    if (file === undefined) throw missing(path);
    return fileStat(file.text, path);
  };
  const existsSync = (path: string) => {
    disk.touched.push({ op: "exists", path });
    const folder = `${path.toLowerCase()}\\`;
    const keys = [...disk.files.keys()];
    return disk.files.has(path.toLowerCase()) || keys.some((key) => key.startsWith(folder));
  };
  const realpath = (path: string) => (disk.touched.push({ op: "realpath", path }), path);
  const realpathSync = Object.assign(realpath, { native: realpath });
  const readdirSync = (dir: string) => {
    disk.touched.push({ op: "readdir", path: dir });
    const names = new Map<string, boolean>();
    for (const { path } of disk.files.values()) {
      if (!path.toLowerCase().startsWith(`${dir.toLowerCase()}\\`)) continue;
      const [name, ...rest] = path.slice(dir.length + 1).split("\\");
      names.set(name!, rest.length > 0);
    }
    return [...names].map(([name, folder]) => ({
      name,
      isDirectory: () => folder,
      isFile: () => !folder,
    }));
  };
  const openSync = (path: string) => {
    found("open", path);
    const fd = disk.open.size + 100;
    disk.open.set(fd, path);
    return fd;
  };
  const textOf = (from: number | string) =>
    typeof from === "number"
      ? disk.files.get(disk.open.get(from)!.toLowerCase())!.text
      : found("read", from).text;
  const readFileSync = (from: number | string, encoding?: unknown) =>
    encoding ? textOf(from) : Buffer.from(textOf(from));
  const fstatSync = (fd: number) => fileStat(textOf(fd), disk.open.get(fd)!);
  const readSync = (fd: number, buffer: Buffer, offset: number, length: number) =>
    Buffer.from(textOf(fd)).copy(buffer, offset, 0, length);
  const closeSync = (fd: number) => disk.open.delete(fd);
  const overrides = {
    statSync,
    lstatSync,
    existsSync,
    realpathSync,
    readdirSync,
    openSync,
    readFileSync,
    fstatSync,
    readSync,
    closeSync,
  };
  return { ...fs, ...overrides, default: { ...fs, ...overrides } };
});

const { buildPublishFileMap, createPublishArchive, stagePublishFiles } =
  await import("./publishProject.js");

type OnLeftOut = Parameters<typeof stagePublishFiles>[2];

// Each spelling of another computer's share or a device path that a page might hold.
const SHARES = [
  "\\\\host\\share\\a.png",
  "/\\host\\share\\b.png",
  "\\/host/share/c.png",
  "\\\\?\\UNC\\host\\share\\d.png",
  "\\\\.\\pipe\\e",
  "\\\\.\\UNC\\host\\share\\j.png",
  "\\\\?\\D:\\media\\f.png",
  "%5C%5Chost%5Cshare%5Ch.png",
  "%2F%5Chost%5Cshare%5Ck.png",
  "\\\\host\\share\\i.png?v=2",
];
const onAShare = (path: string) => /^[\\/]{2}/.test(path);

function setUp(project: string, files: Record<string, string>) {
  disk.files.clear();
  disk.touched.length = 0;
  disk.open.clear();
  for (const [path, text] of Object.entries(files)) {
    const full = path.includes(":") || onAShare(path) ? path : `${project}\\${path}`;
    disk.files.set(full.toLowerCase(), { path: full, text });
  }
  for (const share of ["\\\\host\\share\\a.png", "\\\\host\\share\\bg.png"]) {
    disk.files.set(share.toLowerCase(), { path: share, text: "png" });
  }
}

// `publish` stages through buildPublishFileMap; `cloud render`, with or without --dry-run, calls
// stagePublishFiles with a size above which files stay on disk and the entry page.
const UPLOADS = {
  publish: (project: string, onLeftOut: OnLeftOut) => buildPublishFileMap(project, onLeftOut),
  "cloud render": (project: string, onLeftOut: OnLeftOut) =>
    stagePublishFiles(project, 1, onLeftOut, undefined, "index.html"),
  "the published archive": (project: string, onLeftOut: OnLeftOut) => {
    createPublishArchive(project, onLeftOut);
    return buildPublishFileMap(project);
  },
};

function stage(upload: keyof typeof UPLOADS, project: string) {
  const leftOut: { reference: string; reason: string }[] = [];
  const files = UPLOADS[upload](project, (_warning, { reference, reason }) =>
    leftOut.push({ reference, reason }),
  );
  return { files, leftOut };
}

const PROJECT = "C:\\project";
const PAGE =
  `<link rel="stylesheet" href="style.css">` +
  SHARES.map((src) => `<img src="${src}">`).join("") +
  `<img srcset="\\\\host\\share\\s.png 2x">` +
  `<img src="D:\\media\\pic.png"><img src="../outside/near.png">`;
const LOCAL = {
  "index.html": PAGE,
  "style.css": `body { background: url(\\\\host\\share\\bg.png) }`,
  "D:\\media\\pic.png": "png",
  "C:\\outside\\near.png": "png",
};

describe.each(Object.keys(UPLOADS) as (keyof typeof UPLOADS)[])(
  "%s under Windows rules",
  (upload) => {
    it("never looks at another computer's share or a device path, however it is written", () => {
      setUp(PROJECT, LOCAL);
      stage(upload, PROJECT);
      expect(disk.touched.filter(({ path }) => onAShare(path))).toEqual([]);
    });

    it("reports each of those references as left out", () => {
      setUp(PROJECT, LOCAL);
      const { leftOut } = stage(upload, PROJECT);
      const shared = leftOut.filter(({ reason }) => reason === "network_share");
      expect(shared.map(({ reference }) => reference).sort()).toEqual(
        [...SHARES, "\\\\host\\share\\s.png", "\\\\host\\share\\bg.png"].sort(),
      );
    });

    it("still uploads local files outside the project, on this drive or another", () => {
      setUp(PROJECT, LOCAL);
      const { files } = stage(upload, PROJECT);
      const ext = [...files.keys()].filter((key) => key.startsWith("_ext/"));
      expect(ext.some((key) => key.endsWith("pic.png"))).toBe(true);
      expect(ext.some((key) => key.endsWith("near.png"))).toBe(true);
    });

    it("still uploads a file on the share the project itself lives on", () => {
      const project = "\\\\nas\\films\\project";
      setUp(project, {
        "index.html": `<img src="\\\\NAS\\films\\shared\\pic.png">`,
        "\\\\nas\\films\\shared\\pic.png": "png",
      });
      const { files, leftOut } = stage(upload, project);
      expect(leftOut).toEqual([]);
      expect([...files.keys()].some((key) => key.endsWith("pic.png"))).toBe(true);
    });
  },
);

describe("a page that came in with an imported project", () => {
  it("has its outside references left out before any of them is opened", () => {
    setUp(PROJECT, {
      ...LOCAL,
      ".hyperframes\\received-files.json": JSON.stringify({ files: ["index.html"] }),
    });
    const { files, leftOut } = stage("cloud render", PROJECT);
    expect(leftOut).toContainEqual({ reference: "../outside/near.png", reason: "received" });
    expect(leftOut).toContainEqual({
      reference: "\\\\host\\share\\a.png",
      reason: "network_share",
    });
    expect([...files.keys()].filter((key) => key.startsWith("_ext/"))).toEqual([]);
    const probes = disk.touched.filter(({ op }) => op !== "realpath");
    expect(probes.filter(({ path }) => /outside|media/i.test(path))).toEqual([]);
    expect(disk.touched.filter(({ path }) => onAShare(path))).toEqual([]);
  });
});
