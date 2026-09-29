import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { loadRuntimeSource } from "./runtimeSource.js";

const hooks = vi.hoisted(() => ({
  dir: "",
  source: "",
  inlined: "",
  checked: () => {},
  beforeRead: () => {},
  active: new Set<number>(),
  opened: 0,
}));
vi.mock("@hyperframes/core", () => ({
  loadHyperframeRuntimeSource: () => hooks.source,
  getHyperframeRuntimeScript: () => hooks.inlined || null,
}));
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof path>();
  return {
    ...actual,
    resolve: (...parts: string[]) => {
      const name = parts.at(-1) ?? "";
      if (hooks.dir && ["hyperframe-runtime.js", "hyperframe.runtime.iife.js"].includes(name))
        return actual.join(hooks.dir, name);
      return actual.resolve(...parts);
    },
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: (file: fs.PathLike) => {
      if (String(file).endsWith("entry.ts")) return true;
      const exists = actual.existsSync(file);
      if (exists) hooks.checked();
      return exists;
    },
    openSync: (file: fs.PathLike, flags: string | number) => {
      const fd = actual.openSync(file, flags);
      hooks.active.add(fd);
      hooks.opened++;
      return fd;
    },
    fstatSync: (fd: number) => {
      const stat = actual.fstatSync(fd);
      hooks.checked();
      return stat;
    },
    closeSync: (fd: number) => {
      actual.closeSync(fd);
      hooks.active.delete(fd);
    },
    readFileSync: (file: fs.PathOrFileDescriptor, encoding?: BufferEncoding) => {
      hooks.beforeRead();
      return encoding ? actual.readFileSync(file, encoding) : actual.readFileSync(file);
    },
  };
});

describe("prebuilt runtime file reads", () => {
  beforeEach(() => {
    hooks.dir = fs.mkdtempSync(path.join(tmpdir(), "hf-runtime-read-"));
    hooks.opened = 0;
    hooks.active.clear();
  });
  afterEach(() => {
    hooks.checked = () => {};
    hooks.beforeRead = () => {};
    hooks.source = "";
    hooks.inlined = "";
    fs.rmSync(hooks.dir, { recursive: true, force: true });
    hooks.dir = "";
  });
  function expectClosed() {
    expect(hooks.opened).toBeGreaterThan(0);
    expect(hooks.active.size).toBe(0);
  }

  it.each(["hyperframe-runtime.js", "hyperframe.runtime.iife.js"])(
    "reads checked %s despite replacement",
    async (name) => {
      const file = path.join(hooks.dir, name);
      fs.writeFileSync(file, "checked runtime");
      hooks.checked = () => {
        hooks.checked = () => {};
        fs.renameSync(file, path.join(hooks.dir, "original"));
        fs.writeFileSync(file, "replacement runtime");
      };
      expect(await loadRuntimeSource()).toBe("checked runtime");
      expectClosed();
    },
  );

  it("preserves source, inline and artifact priority", async () => {
    fs.writeFileSync(path.join(hooks.dir, "hyperframe-runtime.js"), "first artifact");
    fs.writeFileSync(path.join(hooks.dir, "hyperframe.runtime.iife.js"), "second artifact");
    hooks.source = "source";
    hooks.inlined = "inline";
    expect(await loadRuntimeSource()).toBe("source");
    hooks.source = "";
    expect(await loadRuntimeSource()).toBe("inline");
    expect(hooks.opened).toBe(0);
    hooks.inlined = "";
    expect(await loadRuntimeSource()).toBe("first artifact");
    expectClosed();
  });

  it("preserves an empty first artifact", async () => {
    fs.writeFileSync(path.join(hooks.dir, "hyperframe-runtime.js"), "");
    fs.writeFileSync(path.join(hooks.dir, "hyperframe.runtime.iife.js"), "second artifact");
    expect(await loadRuntimeSource()).toBe("");
    expectClosed();
  });

  it("returns null when artifacts are absent", async () => {
    expect(await loadRuntimeSource()).toBeNull();
    expect(hooks.active.size).toBe(0);
  });

  it.each(["stat", "read"])("closes an artifact after %s failure", async (step) => {
    fs.writeFileSync(path.join(hooks.dir, "hyperframe-runtime.js"), "bytes");
    const fail = () => {
      throw new Error("Injected artifact failure");
    };
    if (step === "stat") hooks.checked = fail;
    else hooks.beforeRead = fail;
    await expect(loadRuntimeSource()).rejects.toThrow("Injected artifact failure");
    expectClosed();
  });
});
