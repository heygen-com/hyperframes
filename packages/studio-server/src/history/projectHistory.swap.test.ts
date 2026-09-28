// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { START, type HistoryWho } from "./historyLog";
import { HistoryClosedError, openProjectHistory } from "./projectHistory";

// Lets a test swap the folder at an exact point inside the history's own copies.
const hooks = vi.hoisted(() => ({
  afterWrite: null as null | (() => void),
  beforeWrite: null as null | (() => void),
  beforePut: null as null | (() => void),
  onReceipt: null as null | ((path: string) => void),
  recreated: null as null | string,
}));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  const statSync = ((path: string, options?: object) => {
    const stat = original.statSync(path, options);
    if (!stat || resolve(String(path)) !== hooks.recreated) return stat;
    return new Proxy(stat, {
      get: (target, key) =>
        key === "birthtimeMs" ? target.birthtimeMs + 1000 : Reflect.get(target, key),
    });
  }) as typeof original.statSync;
  return { ...original, statSync };
});
vi.mock("../helpers/fileVersion", async (importOriginal) => {
  const original = await importOriginal<typeof import("../helpers/fileVersion")>();
  return {
    ...original,
    recordFileWriteReceipt: (...args: Parameters<typeof original.recordFileWriteReceipt>) => {
      hooks.onReceipt?.(args[1].path);
      return original.recordFileWriteReceipt(...args);
    },
  };
});
vi.mock("./blobStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./blobStore")>();
  return {
    ...original,
    openBlobStore: async (dir: string) => {
      const store = await original.openBlobStore(dir);
      return {
        ...store,
        put: async (path: string) => {
          hooks.beforePut?.();
          return store.put(path);
        },
        writeTo: async (hash: string, path: string, beforeReplace?: () => void) => {
          hooks.beforeWrite?.();
          await store.writeTo(hash, path, beforeReplace);
          hooks.afterWrite?.();
        },
      };
    },
  };
});

const you: HistoryWho = { kind: "person", name: "You" };
const cleanup: Array<() => unknown> = [];
const files = ["a.html", "b.html", "c.html"];

afterEach(async () => {
  hooks.afterWrite = null;
  hooks.beforeWrite = null;
  hooks.beforePut = null;
  hooks.onReceipt = null;
  hooks.recreated = null;
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function unopened() {
  const root = tempDir("hf-history-swap-");
  const projectDir = join(root, "project");
  const moved = join(root, "moved");
  mkdirSync(projectDir);
  for (const path of files) writeFileSync(join(projectDir, path), "v1");
  const historyRoot = tempDir("hf-history-swap-root-");
  const swap = () => {
    renameSync(projectDir, moved);
    mkdirSync(projectDir);
    for (const path of files) writeFileSync(join(projectDir, path), "new project");
  };
  const texts = (dir: string) => files.map((path) => readFileSync(join(dir, path), "utf-8"));
  return { projectDir, historyRoot, moved, swap, texts };
}

async function swappable() {
  const folders = unopened();
  const history = await openProjectHistory(folders);
  cleanup.push(() => history.close());
  return { history, ...folders };
}

describe("a project folder swapped while the history is at work", () => {
  it("stops a restore at the next file, so none of the old project's bytes land in the new one", async () => {
    const { history, projectDir, moved, swap, texts } = await swappable();
    const window = await history.beginWindow(you, "Edit");
    for (const path of files) writeFileSync(join(projectDir, path), "edited");
    await window.close();
    hooks.afterWrite = () => {
      hooks.afterWrite = null;
      swap();
    };

    await expect(history.restore(START, you)).rejects.toThrow(HistoryClosedError);
    expect(texts(projectDir)).toEqual(["new project", "new project", "new project"]);
    expect(texts(moved).filter((text) => text === "edited")).toHaveLength(2);
  });

  it("refuses a restore write whose folder was swapped after its check, before the file is replaced", async () => {
    const { history, projectDir, moved, swap, texts } = await swappable();
    const window = await history.beginWindow(you, "Edit");
    for (const path of files) writeFileSync(join(projectDir, path), "edited");
    await window.close();
    hooks.beforeWrite = () => {
      hooks.beforeWrite = null;
      swap();
    };

    await expect(history.restore(START, you)).rejects.toThrow(HistoryClosedError);
    expect([texts(projectDir), texts(moved)]).toEqual([
      ["new project", "new project", "new project"],
      ["edited", "edited", "edited"],
    ]);
  });

  it("refuses a restore delete whose folder was swapped after its check, so the new project keeps the file", async () => {
    const { history, projectDir, swap } = await swappable();
    const window = await history.beginWindow(you, "Add");
    writeFileSync(join(projectDir, "d.html"), "added");
    await window.close();
    hooks.onReceipt = (path) => {
      if (path !== "d.html") return;
      hooks.onReceipt = null;
      swap();
      writeFileSync(join(projectDir, "d.html"), "new project");
    };

    await expect(history.restore(START, you, { writeToken: "t" })).rejects.toThrow(
      HistoryClosedError,
    );
    expect(readFileSync(join(projectDir, "d.html"), "utf-8")).toBe("new project");
  });

  it("opens with a first baseline that skips a file deleted while it was read", async () => {
    const { projectDir, historyRoot } = unopened();
    let puts = 0;
    hooks.beforePut = () => {
      if (++puts === 2) rmSync(join(projectDir, "b.html"));
    };

    const history = await openProjectHistory({ projectDir, historyRoot });
    cleanup.push(() => history.close());
    expect(history.list()).toEqual([]);
  });

  it("drops a first baseline read partly from a swapped folder, so the original never gets its bytes", async () => {
    const { projectDir, historyRoot, moved, swap, texts } = unopened();
    let puts = 0;
    hooks.beforePut = () => {
      if (++puts === 2) swap();
    };
    await expect(openProjectHistory({ projectDir, historyRoot })).rejects.toThrow(
      HistoryClosedError,
    );
    hooks.beforePut = null;

    const original = await openProjectHistory({ projectDir: moved, historyRoot });
    cleanup.push(() => original.close());
    await original.restore(START, you);
    expect(texts(moved)).toEqual(["v1", "v1", "v1"]);
  });

  it("refuses, while open, a copy carrying its marker that came back on the recycled inode", async () => {
    const { history, projectDir, texts } = await swappable();
    const window = await history.beginWindow(you, "Edit");
    for (const path of files) writeFileSync(join(projectDir, path), "edited");
    await window.close();
    hooks.recreated = resolve(projectDir);

    expect(() => history.list()).toThrow(HistoryClosedError);
    await expect(history.restore(START, you)).rejects.toThrow(HistoryClosedError);
    expect(texts(projectDir)).toEqual(["edited", "edited", "edited"]);
  });

  it("stops a sweep at the next file, so the old history never files the new project's bytes", async () => {
    const { history, projectDir, historyRoot, moved, swap } = await swappable();
    for (const path of files) writeFileSync(join(projectDir, path), "edited");
    let puts = 0;
    hooks.beforePut = () => {
      if (++puts === 2) swap();
    };
    await history.flush();
    await history.close();

    const again = await openProjectHistory({ projectDir: moved, historyRoot });
    cleanup.push(() => again.close());
    const filed: string[] = [];
    for (const entry of again.list())
      for (const file of entry.files)
        if (file.after) filed.push(String(await again.readBlob(file.after)));
    expect(filed).toContain("edited");
    expect(filed).not.toContain("new project");
  });
});
