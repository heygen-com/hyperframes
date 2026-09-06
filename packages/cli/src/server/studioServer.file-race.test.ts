import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  createStudioServer,
  loadPreviewServerBuildSignature,
  type StudioServer,
} from "./studioServer.js";

const hooks = vi.hoisted(() => ({
  studioDir: "",
  runtimeDir: "",
  ignoreNextExists: "",
  useRuntimeFallback: false,
  checked: (_path: fs.PathLike) => {},
  beforeRead: () => {},
  opened: new Map<number, fs.PathLike>(),
  active: new Set<number>(),
}));

vi.mock("./runtimeSource.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtimeSource.js")>();
  return {
    ...actual,
    loadRuntimeSource: () =>
      hooks.useRuntimeFallback ? Promise.resolve(null) : actual.loadRuntimeSource(),
    loadRuntimeSourceSignature: () => Promise.resolve("stable-runtime-signature"),
  };
});

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof path>();
  return {
    ...actual,
    resolve: (...parts: string[]) => {
      if (
        hooks.studioDir &&
        parts.length === 2 &&
        parts[0]?.endsWith("server") &&
        parts[1] === "studio"
      )
        return hooks.studioDir;
      if (
        hooks.runtimeDir &&
        ["hyperframe-runtime.js", "hyperframe.runtime.iife.js"].includes(parts.at(-1) ?? "")
      ) {
        return actual.resolve(hooks.runtimeDir, parts.at(-1) ?? "");
      }
      return actual.resolve(...parts);
    },
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: (file: fs.PathLike) => {
      const exists = actual.existsSync(file);
      if (file === hooks.ignoreNextExists) hooks.ignoreNextExists = "";
      else if (exists) hooks.checked(file);
      return exists;
    },
    openSync: (file: fs.PathLike, flags: number | string) => {
      const fd = actual.openSync(file, flags);
      hooks.opened.set(fd, file);
      hooks.active.add(fd);
      return fd;
    },
    closeSync: (fd: number) => {
      actual.closeSync(fd);
      hooks.active.delete(fd);
    },
    statSync: (file: fs.PathLike) => {
      const stat = actual.statSync(file);
      hooks.checked(file);
      return stat;
    },
    fstatSync: (fd: number) => {
      const stat = actual.fstatSync(fd);
      const file = hooks.opened.get(fd);
      if (file) hooks.checked(file);
      return stat;
    },
    readFileSync: (file: fs.PathOrFileDescriptor, encoding?: BufferEncoding) => {
      hooks.beforeRead();
      return encoding ? actual.readFileSync(file, encoding) : actual.readFileSync(file);
    },
  };
});

describe("Studio bundle file reads", () => {
  let root: string;
  let server: StudioServer;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), "hf-studio-static-"));
    hooks.studioDir = path.join(root, "studio");
    hooks.runtimeDir = path.join(root, "runtime");
    fs.mkdirSync(hooks.runtimeDir);
    fs.writeFileSync(path.join(hooks.runtimeDir, "hyperframe-runtime.js"), "checked runtime");
    const projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir);
    fs.mkdirSync(hooks.studioDir);
    fs.mkdirSync(path.join(hooks.studioDir, "assets"));
    fs.mkdirSync(path.join(hooks.studioDir, "icons"));
    fs.writeFileSync(
      path.join(hooks.studioDir, "index.html"),
      "<html><head></head><body>Studio</body></html>",
    );
    server = createStudioServer({ projectDir });
    hooks.opened.clear();
    hooks.active.clear();
  });
  afterEach(() => {
    hooks.checked = () => {};
    hooks.beforeRead = () => {};
    server.watcher.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    hooks.studioDir = "";
    hooks.runtimeDir = "";
    hooks.ignoreNextExists = "";
    hooks.useRuntimeFallback = false;
  });
  function expectClosed() {
    expect(hooks.opened.size).toBeGreaterThan(0);
    expect(hooks.active.size).toBe(0);
  }

  it.each(["assets/main.js", "icons/logo.svg", "favicon.svg", "index.html"])(
    "reads the checked %s despite replacement",
    async (name) => {
      const file = path.join(hooks.studioDir, name);
      fs.writeFileSync(file, "checked bytes");
      hooks.checked = (checked) => {
        if (checked !== file) return;
        hooks.checked = () => {};
        fs.renameSync(file, path.join(root, "original"));
        fs.writeFileSync(file, "replacement bytes");
      };
      const response = await server.app.request(name === "index.html" ? "/" : `/${name}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("checked bytes");
      expectClosed();
    },
  );

  it.each([
    ["assets/main.js", "text/javascript"],
    ["icons/logo.svg", "image/svg+xml"],
    ["favicon.svg", "image/svg+xml"],
  ])("preserves %s MIME and cache headers", async (name, mime) => {
    fs.writeFileSync(path.join(hooks.studioDir, name), "");
    const response = await server.app.request(`/${name}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(mime);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expectClosed();
  });

  it("hashes the checked Studio index despite replacement", async () => {
    const file = path.join(hooks.studioDir, "index.html");
    const expected = await loadPreviewServerBuildSignature();
    hooks.ignoreNextExists = file; // bundle selection precedes the content read
    hooks.checked = (checked) => {
      if (checked !== file) return;
      hooks.checked = () => {};
      fs.renameSync(file, path.join(root, "original-index"));
      fs.writeFileSync(file, "replacement index");
    };
    expect(await loadPreviewServerBuildSignature()).toBe(expected);
    expectClosed();
  });

  it("serves the checked runtime fallback despite replacement", async () => {
    hooks.useRuntimeFallback = true;
    const file = path.join(hooks.runtimeDir, "hyperframe-runtime.js");
    hooks.checked = (checked) => {
      if (checked !== file) return;
      hooks.checked = () => {};
      fs.renameSync(file, path.join(root, "original-runtime"));
      fs.writeFileSync(file, "replacement runtime");
    };
    const response = await server.app.request("/api/runtime.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("checked runtime");
    expectClosed();
  });

  it.each(["signature", "runtime"])("closes a failed %s read", async (kind) => {
    hooks.useRuntimeFallback = true;
    hooks.beforeRead = () => {
      throw new Error("Injected read failure");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    if (kind === "signature")
      await expect(loadPreviewServerBuildSignature()).rejects.toThrow("Injected read failure");
    else expect((await server.app.request("/api/runtime.js")).status).toBe(500);
    expectClosed();
  });

  it("returns 404 for absent assets and directories", async () => {
    fs.mkdirSync(path.join(hooks.studioDir, "assets", "folder"));
    for (const route of ["/assets/missing", "/assets/folder", "/icons/missing", "/favicon.svg"]) {
      const response = await server.app.request(route);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("not found");
    }
    expectClosed();
  });

  it.skipIf(process.platform === "win32")("rejects an asset FIFO without blocking", async () => {
    execFileSync("mkfifo", [path.join(hooks.studioDir, "assets", "pipe")]);
    expect((await server.app.request("/assets/pipe")).status).toBe(404);
    expectClosed();
  });

  it("continues serving symlinked bundle assets", async () => {
    const shared = path.join(root, "shared");
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, "file.js"), "shared asset");
    fs.symlinkSync(
      shared,
      path.join(hooks.studioDir, "assets", "shared"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const response = await server.app.request("/assets/shared/file.js");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("shared asset");
    expectClosed();
  });

  it("preserves the unavailable-bundle diagnostic", async () => {
    fs.unlinkSync(path.join(hooks.studioDir, "index.html"));
    const response = await server.app.request("/");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("HyperFrames Studio unavailable");
  });

  it("still injects runtime environment into the SPA fallback", async () => {
    vi.stubEnv("VITE_STUDIO_STATIC_TEST", "runtime-value");
    const response = await server.app.request("/editor");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Studio");
    expect(text).toContain('"VITE_STUDIO_STATIC_TEST":"runtime-value"');
    expectClosed();
  });

  it.each(["stat", "read"])("closes a file when %s fails", async (step) => {
    fs.writeFileSync(path.join(hooks.studioDir, "assets", "file.js"), "bytes");
    const fail = () => {
      throw new Error("Injected file failure");
    };
    if (step === "stat") hooks.checked = fail;
    else hooks.beforeRead = fail;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await server.app.request("/assets/file.js")).status).toBe(500);
    expectClosed();
  });
});
