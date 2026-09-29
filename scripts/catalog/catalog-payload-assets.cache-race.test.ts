import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { processAssets, externalizeDataUris } from "../catalog-payload-assets.ts";

const hooks = vi.hoisted(() => {
  const state: {
    dest: string;
    beforePublish?: () => void;
    failWrite: boolean;
    failLink: boolean;
    failCleanup: boolean;
    stagedBytes?: Buffer;
    stages: string[];
  } = { dest: "", failWrite: false, failLink: false, failCleanup: false, stages: [] };
  return state;
});
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  function beforePublish(): void {
    const hook = hooks.beforePublish;
    hooks.beforePublish = undefined;
    hook?.();
  }
  return {
    ...fs,
    mkdtempSync: (...args: Parameters<typeof fs.mkdtempSync>) => {
      const dir = fs.mkdtempSync(...args);
      hooks.stages.push(String(dir));
      return dir;
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (String(args[0]) === hooks.dest) beforePublish();
      if (hooks.failWrite) {
        fs.writeFileSync(args[0], "partial");
        throw new Error("write failure");
      }
      return fs.writeFileSync(...args);
    },
    linkSync: (...args: Parameters<typeof fs.linkSync>) => {
      hooks.stagedBytes = fs.readFileSync(args[0]);
      beforePublish();
      if (hooks.failLink) throw new Error("link failure");
      return fs.linkSync(...args);
    },
    rmSync: (...args: Parameters<typeof fs.rmSync>) => {
      if (hooks.failCleanup) throw new Error("cleanup failure");
      return fs.rmSync(...args);
    },
  };
});
const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
let root: string;
let project: string;
let target: { dir: string; urlBase: string };
const bytes = Buffer.alloc(4096, 42);
const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.png`;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "hf-catalog-cache-"));
  project = join(root, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(join(project, "asset.png"), bytes);
  target = { dir: join(root, "cache"), urlBase: "/assets" };
  Object.assign(hooks, {
    dest: join(target.dir, name),
    beforePublish: undefined,
    failWrite: false,
    failLink: false,
    failCleanup: false,
    stagedBytes: undefined,
    stages: [],
  });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function publish(kind: string): string {
  if (kind === "reference") {
    const result = processAssets('<img src="asset.png">', project, target);
    expect(result.hosted).toBe(1);
    expect(result.inlined).toBe(0);
    expect(result.unresolved).toEqual([]);
    return result.html;
  }
  const result = externalizeDataUris(
    `<img src="data:image/png;base64,${bytes.toString("base64")}">`,
    target,
  );
  expect(result.externalized).toBe(1);
  return result.html;
}
function assertNoStages(): void {
  for (const stage of hooks.stages) expect(fs.existsSync(stage)).toBe(false);
}

describe.each(["reference", "data URI"])("catalog %s cache publication", (kind) => {
  it("publishes complete bytes with the existing hash and reuses cache hits without staging", () => {
    expect(publish(kind)).toBe(`<img src="/assets/${name}">`);
    expect(hooks.stagedBytes).toEqual(bytes);
    expect(fs.readFileSync(hooks.dest)).toEqual(bytes);
    assertNoStages();
    hooks.failWrite = true;
    const count = hooks.stages.length;
    expect(publish(kind)).toBe(`<img src="/assets/${name}">`);
    expect(hooks.stages.length).toBe(count);
  });
  it.each(["file", "symlink", "dangling symlink"])("does not overwrite a competing %s", (entry) => {
    const outside = join(root, "outside.png");
    if (entry === "symlink") fs.writeFileSync(outside, "outside");
    hooks.beforePublish = () => {
      if (entry === "file") fs.writeFileSync(hooks.dest, "winner");
      else fs.symlinkSync(outside, hooks.dest, "file");
    };
    expect(publish(kind)).toBe(`<img src="/assets/${name}">`);
    expect(hooks.beforePublish).toBeUndefined();
    if (entry === "file") expect(fs.readFileSync(hooks.dest, "utf8")).toBe("winner");
    else {
      expect(fs.lstatSync(hooks.dest).isSymbolicLink()).toBe(true);
      if (entry === "symlink") expect(fs.readFileSync(outside, "utf8")).toBe("outside");
      else expect(fs.existsSync(outside)).toBe(false);
    }
    assertNoStages();
  });
  it("leaves a pre-existing dangling destination link untouched", () => {
    fs.mkdirSync(target.dir);
    const outside = join(root, "outside.png");
    fs.symlinkSync(outside, hooks.dest, "file");
    publish(kind);
    expect(fs.existsSync(outside)).toBe(false);
    expect(fs.lstatSync(hooks.dest).isSymbolicLink()).toBe(true);
    expect(hooks.stages).toEqual([]);
  });
  it("rejects a cache directory linked outside without writing there", () => {
    const outside = join(root, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, target.dir, process.platform === "win32" ? "junction" : "dir");
    expect(() => publish(kind)).toThrow("Catalog cache must be a real directory");
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("removes a partial staging file after write failure without publishing it", () => {
    hooks.failWrite = true;
    expect(() => publish(kind)).toThrow("write failure");
    expect(fs.existsSync(hooks.dest)).toBe(false);
    assertNoStages();
  });
  it("preserves publication errors and cleans staging", () => {
    hooks.failLink = true;
    expect(() => publish(kind)).toThrow("link failure");
    expect(fs.existsSync(hooks.dest)).toBe(false);
    assertNoStages();
  });
  it("does not replace a publication error with a cleanup error", () => {
    hooks.failLink = true;
    hooks.failCleanup = true;
    expect(() => publish(kind)).toThrow("link failure");
    expect(fs.existsSync(hooks.dest)).toBe(false);
  });
  it("keeps a successful publication successful if cleanup fails", () => {
    hooks.failCleanup = true;
    expect(publish(kind)).toBe(`<img src="/assets/${name}">`);
    expect(fs.readFileSync(hooks.dest)).toEqual(bytes);
    expect(hooks.stages.map((stage) => dirname(stage))).toEqual([target.dir]);
  });
});
