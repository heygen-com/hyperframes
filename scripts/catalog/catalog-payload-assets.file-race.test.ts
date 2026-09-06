import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  processAssets,
  inlineMountedComposition,
  hostItemDirectory,
  MAX_HOSTED_DIRECTORY_BYTES,
} from "../catalog-payload-assets.ts";

const hooks = vi.hoisted(() => {
  const state: {
    target: string;
    swap?: () => void;
    beforeOpen?: () => void;
    beforeWrite?: () => void;
    afterStat?: () => void;
    forbidUnbounded: boolean;
    bytesRead: number;
    maxReadSize: number;
    readCount: number;
    failStat: boolean;
    failRead: boolean;
    fds: Map<number, string>;
  } = {
    target: "",
    forbidUnbounded: false,
    bytesRead: 0,
    maxReadSize: Infinity,
    readCount: 1,
    failStat: false,
    failRead: false,
    fds: new Map(),
  };
  return state;
});
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  function beforeRead(file: number | string): void {
    const path = typeof file === "number" ? hooks.fds.get(file) : file;
    if (!path || !hooks.target) return;
    if (fs.realpathSync(path) !== fs.realpathSync(hooks.target)) return;
    if (--hooks.readCount !== 0) return;
    const swap = hooks.swap;
    hooks.swap = undefined;
    swap?.();
    if (hooks.failRead) throw new Error("read failure");
  }
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const beforeOpen = hooks.beforeOpen;
      hooks.beforeOpen = undefined;
      beforeOpen?.();
      const fd = fs.openSync(...args);
      hooks.fds.set(fd, String(args[0]));
      return fd;
    },
    fstatSync: (...args: Parameters<typeof fs.fstatSync>) => {
      if (hooks.failStat) throw new Error("stat failure");
      const stat = fs.fstatSync(...args);
      const afterStat = hooks.afterStat;
      hooks.afterStat = undefined;
      afterStat?.();
      return stat;
    },
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      if (hooks.forbidUnbounded) throw new Error("unbounded directory read");
      beforeRead(typeof args[0] === "number" ? args[0] : String(args[0]));
      return fs.readFileSync(...args);
    },
    readSync: (
      fd: number,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number | null,
    ) => {
      beforeRead(fd);
      const count = fs.readSync(fd, buffer, offset, Math.min(length, hooks.maxReadSize), position);
      hooks.bytesRead += count;
      return count;
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      const beforeWrite = hooks.beforeWrite;
      hooks.beforeWrite = undefined;
      beforeWrite?.();
      return fs.writeFileSync(...args);
    },
    closeSync: (fd: number) => {
      fs.closeSync(fd);
      hooks.fds.delete(fd);
    },
  };
});
const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
let root: string;
let project: string;
let out: { dir: string; urlBase: string };
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "hf-catalog-security-"));
  project = join(root, "project");
  fs.mkdirSync(project);
  out = { dir: join(root, "output"), urlBase: "/assets" };
  Object.assign(hooks, {
    target: "",
    swap: undefined,
    beforeOpen: undefined,
    beforeWrite: undefined,
    afterStat: undefined,
    forbidUnbounded: false,
    bytesRead: 0,
    maxReadSize: Infinity,
    readCount: 1,
    failStat: false,
    failRead: false,
  });
});
afterEach(() => {
  const leaked = [...hooks.fds.keys()];
  for (const fd of leaked) fs.closeSync(fd);
  hooks.fds.clear();
  fs.rmSync(root, { recursive: true, force: true });
  expect(leaked).toEqual([]);
});
function file(name: string, bytes = "checked") {
  const path = join(project, name);
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, bytes);
  return path;
}
function arm(path: string) {
  hooks.target = path;
  hooks.swap = () => {
    fs.renameSync(path, join(root, "original"));
    fs.writeFileSync(path, "unchecked");
  };
}

describe("catalog source reads", () => {
  it.each(["png", "glb"])("uses checked .%s bytes for hosted and inlined references", (ext) => {
    arm(file(`asset.${ext}`));
    const result = processAssets(`<img src="asset.${ext}">`, project, out);
    if (ext === "png") {
      const digest = createHash("sha256").update("checked").digest("hex").slice(0, 16);
      expect(result.html).toBe(`<img src="/assets/${digest}.png">`);
      expect(fs.readFileSync(join(out.dir, `${digest}.png`), "utf8")).toBe("checked");
    } else expect(result.html).toContain(Buffer.from("checked").toString("base64"));
    expect(hooks.swap).toBeUndefined();
  });
  it("uses checked bytes for mounted composition HTML", () => {
    arm(file("clip.html"));
    expect(inlineMountedComposition('<div data-composition-src="clip.html">', project)).toContain(
      Buffer.from("checked").toString("base64"),
    );
    expect(hooks.swap).toBeUndefined();
  });
  it.each([false, true])(
    "uses checked bytes in directory copies (download mirror: %s)",
    (mirror) => {
      arm(file(mirror ? "_downloads/font.woff2" : "font.woff2"));

      expect(hostItemDirectory(project, out.dir, "/item/")).toBe("/item/");
      expect(fs.readFileSync(join(out.dir, "font.woff2"), "utf8")).toBe("checked");
      expect(hooks.swap).toBeUndefined();
    },
  );
  it("rejects a replacement that grows beyond the directory budget before open", () => {
    const path = file("asset.png", "x");
    hooks.beforeOpen = () => {
      fs.renameSync(path, join(root, "original"));
      fs.writeFileSync(path, Buffer.alloc(MAX_HOSTED_DIRECTORY_BYTES + 1));
    };
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("");
    expect(hooks.beforeOpen).toBeUndefined();
    expect(fs.existsSync(out.dir)).toBe(false);
  });
  it("bounds a sparse oversized source to the remaining directory budget plus one byte", () => {
    file("a.png", "already counted");
    const path = file("large.mp4", "");
    fs.truncateSync(path, 32 * 1024 * 1024);
    hooks.forbidUnbounded = true;
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("");
    expect(hooks.bytesRead).toBe(MAX_HOSTED_DIRECTORY_BYTES + 1);
    expect(fs.existsSync(out.dir)).toBe(false);
  });
  it("bounds a file that grows after its descriptor stat", () => {
    const path = file("asset.webm", "x");
    hooks.afterStat = () => fs.truncateSync(path, MAX_HOSTED_DIRECTORY_BYTES * 2);
    hooks.forbidUnbounded = true;
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("");
    expect(hooks.afterStat).toBeUndefined();
    expect(hooks.bytesRead).toBe(MAX_HOSTED_DIRECTORY_BYTES + 1);
    expect(fs.existsSync(out.dir)).toBe(false);
  });
  it("handles short descriptor reads without truncating a directory asset", () => {
    file("font.woff2");
    hooks.forbidUnbounded = true;
    hooks.maxReadSize = 2;
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("/item/");
    expect(fs.readFileSync(join(out.dir, "font.woff2"), "utf8")).toBe("checked");
    expect(hooks.bytesRead).toBe(7);
  });
  it("closes a directory source descriptor when its bounded read fails", () => {
    hooks.target = file("asset.png");
    hooks.failRead = true;
    expect(() => hostItemDirectory(project, out.dir, "/item/")).toThrow("read failure");
    expect(hooks.fds.size).toBe(0);
    expect(fs.existsSync(out.dir)).toBe(false);
  });
  it("leaves existing output untouched when collected files exceed the budget", () => {
    file("a.png", "a");
    file("b.png", "b".repeat(MAX_HOSTED_DIRECTORY_BYTES));
    fs.mkdirSync(out.dir);
    fs.writeFileSync(join(out.dir, "a.png"), "existing");
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("");
    expect(fs.readdirSync(out.dir)).toEqual(["a.png"]);
    expect(fs.readFileSync(join(out.dir, "a.png"), "utf8")).toBe("existing");
  });
  it("reuses budgeted bytes for download mirrors after sources change during publication", () => {
    const path = file("_downloads/font.woff2", "x".repeat(MAX_HOSTED_DIRECTORY_BYTES));
    hooks.beforeWrite = () => fs.writeFileSync(path, "unchecked");
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("/item/");
    expect(hooks.beforeWrite).toBeUndefined();
    const original = Buffer.alloc(MAX_HOSTED_DIRECTORY_BYTES, "x");
    expect(fs.readFileSync(join(out.dir, "_downloads/font.woff2")).equals(original)).toBe(true);
    expect(fs.readFileSync(join(out.dir, "font.woff2")).equals(original)).toBe(true);
  });
  it("preserves an internal downloads directory alias using the same collected bytes", () => {
    arm(file("media/font.woff2"));
    fs.symlinkSync(
      join(project, "media"),
      join(project, "_downloads"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("/item/");
    expect(fs.readFileSync(join(out.dir, "media/font.woff2"), "utf8")).toBe("checked");
    expect(fs.readFileSync(join(out.dir, "font.woff2"), "utf8")).toBe("checked");
    expect(fs.existsSync(join(out.dir, "_downloads"))).toBe(false);
    expect(hooks.swap).toBeUndefined();
  });
  it("preserves download mirror precedence over a colliding root asset", () => {
    file("font.woff2", "root");
    file("_downloads/font.woff2", "download");
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("/item/");
    expect(fs.readFileSync(join(out.dir, "font.woff2"), "utf8")).toBe("download");
  });
  it.each(["png", "glb", "html"])("does not publish an external .%s symlink target", (ext) => {
    const outside = join(root, `outside.${ext}`);
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, join(project, `linked.${ext}`), "file");
    if (ext === "html") {
      const html = '<div data-composition-src="linked.html">';
      expect(inlineMountedComposition(html, project)).toBe(html);
    } else {
      const result = processAssets(`<img src="linked.${ext}">`, project, out);
      expect(result.unresolved).toEqual([`linked.${ext}`]);
      expect(result.hosted + result.inlined).toBe(0);
    }
    expect(fs.existsSync(out.dir)).toBe(false);
  });
  it("does not mirror a downloads directory linked outside the project", () => {
    const outside = join(root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, "secret.png"), "secret");
    fs.symlinkSync(
      outside,
      join(project, "_downloads"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(hostItemDirectory(project, out.dir, "/item/")).toBe("");
    expect(fs.existsSync(out.dir)).toBe(false);
  });
  it("keeps internal file links and a symlinked project root working", () => {
    const target = file("asset.glb");
    fs.symlinkSync(target, join(project, "linked.glb"), "file");
    const alias = join(root, "alias");
    fs.symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
    const result = processAssets('<img src="linked.glb">', alias, out);
    expect(result.inlined).toBe(1);
    expect(result.unresolved).toEqual([]);
  });
  it("rejects sibling-prefix mounted composition escapes", () => {
    const sibling = join(root, "project-other");
    fs.mkdirSync(sibling);
    fs.writeFileSync(join(sibling, "clip.html"), "secret");
    const html = '<div data-composition-src="../project-other/clip.html">';
    expect(inlineMountedComposition(html, project)).toBe(html);
  });
  it("preserves missing/probable reference and empty-file behavior", () => {
    fs.mkdirSync(join(project, "dir.png"));
    file("empty.glb", "");
    const result = processAssets(
      '<img src="dir.png"><img src="missing.png"><script>load("probable.png")</script><img src="empty.glb">',
      project,
      out,
    );
    expect(result.unresolved).toEqual(["dir.png", "missing.png"]);
    expect(result.inlined).toBe(1);
    expect(result.html).toContain('src="data:model/gltf-binary;base64,"');
  });
  it.skipIf(process.platform === "win32")("rejects a FIFO without waiting for a writer", () => {
    execFileSync("mkfifo", [join(project, "pipe.png")]);
    expect(processAssets('<img src="pipe.png">', project, out).unresolved).toEqual(["pipe.png"]);
  });
  it.each(["stat", "read"])("closes the source descriptor after %s failure", (failure) => {
    hooks.target = file("asset.png");
    hooks.failStat = failure === "stat";
    hooks.failRead = failure === "read";
    expect(() => processAssets('<img src="asset.png">', project, out)).toThrow(
      `${failure} failure`,
    );
    expect(hooks.fds.size).toBe(0);
  });
});
