import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileServer, type FileServerHandle } from "./fileServer.js";

const hooks = vi.hoisted(() => ({
  checked: (_path: fs.PathLike) => {},
  beforeRead: () => {},
  opened: new Map<number, fs.PathLike>(),
  active: new Set<number>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    openSync: (path: fs.PathLike, flags: number | string) => {
      const fd = actual.openSync(path, flags);
      hooks.opened.set(fd, path);
      hooks.active.add(fd);
      return fd;
    },
    closeSync: (fd: number) => {
      actual.closeSync(fd);
      hooks.active.delete(fd);
    },
    statSync: (path: fs.PathLike) => {
      const stat = actual.statSync(path);
      hooks.checked(path);
      return stat;
    },
    fstatSync: (fd: number) => {
      const stat = actual.fstatSync(fd);
      const path = hooks.opened.get(fd);
      if (path) hooks.checked(path);
      return stat;
    },
    readFileSync: (path: fs.PathOrFileDescriptor, encoding?: BufferEncoding) => {
      hooks.beforeRead();
      return encoding ? actual.readFileSync(path, encoding) : actual.readFileSync(path);
    },
  };
});

describe("file server checked reads", () => {
  let root: string;
  let projectDir: string;
  let compiledDir: string;
  let server: FileServerHandle | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), "hf-server-read-"));
    projectDir = join(root, "project");
    compiledDir = join(root, "compiled");
    fs.mkdirSync(projectDir);
    fs.mkdirSync(compiledDir);
    hooks.opened.clear();
    hooks.active.clear();
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    hooks.checked = () => {};
    hooks.beforeRead = () => {};
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function expectClosed() {
    // HTTP sockets can reuse an already-closed fd before fetch resolves.
    // Track successful real closes instead of probing stale descriptor numbers.
    expect(hooks.opened.size).toBeGreaterThan(0);
    expect(hooks.active.size).toBe(0);
  }

  it.each([
    ["project", "html"],
    ["project", "bin"],
    ["compiled", "html"],
    ["compiled", "bin"],
  ])("reads the checked %s .%s despite replacement", async (source, ext) => {
    const name = `asset.${ext}`;
    const file = join(source === "compiled" ? compiledDir : projectDir, name);
    fs.writeFileSync(join(projectDir, name), "project bytes");
    fs.writeFileSync(file, "checked bytes");
    hooks.checked = (path) => {
      if (path !== file) return;
      hooks.checked = () => {};
      fs.renameSync(file, join(root, "original"));
      fs.writeFileSync(file, "replacement bytes");
    };
    server = await createFileServer({ projectDir, compiledDir });
    const response = await fetch(`${server.url}/${name}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("checked bytes");
    expectClosed();
  });

  it.each(["missing", "directory", "non-directory parent"])(
    "falls back from a compiled %s",
    async (kind) => {
      fs.mkdirSync(join(projectDir, "assets"));
      fs.writeFileSync(join(projectDir, "assets", "file.bin"), "project bytes");
      if (kind === "directory")
        fs.mkdirSync(join(compiledDir, "assets", "file.bin"), { recursive: true });
      if (kind === "non-directory parent") fs.writeFileSync(join(compiledDir, "assets"), "blocker");
      server = await createFileServer({ projectDir, compiledDir });
      const response = await fetch(`${server.url}/assets/file.bin`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("project bytes");
      expectClosed();
    },
  );

  it.skipIf(process.platform === "win32")("skips a compiled FIFO without blocking", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "project bytes");
    execFileSync("mkfifo", [join(compiledDir, "file.bin")]);
    server = await createFileServer({ projectDir, compiledDir });
    const response = await fetch(`${server.url}/file.bin`);
    expect(await response.text()).toBe("project bytes");
    expectClosed();
  });

  it.skipIf(process.platform === "win32")("falls back from a compiled Unix socket", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "project bytes");
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(join(compiledDir, "file.bin"), resolve));
    try {
      server = await createFileServer({ projectDir, compiledDir });
      const response = await fetch(`${server.url}/file.bin`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("project bytes");
      expectClosed();
    } finally {
      await new Promise<void>((resolve, reject) =>
        socket.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("serves an empty compiled file instead of falling back", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "project bytes");
    fs.writeFileSync(join(compiledDir, "file.bin"), "");
    server = await createFileServer({ projectDir, compiledDir });
    const response = await fetch(`${server.url}/file.bin`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expectClosed();
  });

  it("continues serving symlinked assets", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "project bytes");
    fs.symlinkSync(
      projectDir,
      join(compiledDir, "assets"),
      process.platform === "win32" ? "junction" : "dir",
    );
    server = await createFileServer({ projectDir, compiledDir });
    const response = await fetch(`${server.url}/assets/file.bin`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("project bytes");
    expectClosed();
  });

  it("keeps missing files and directories at 404", async () => {
    fs.mkdirSync(join(projectDir, "folder"));
    server = await createFileServer({ projectDir });
    for (const path of ["missing", "folder", "missing/child"]) {
      const response = await fetch(`${server.url}/${path}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });

  it("injects scripts only into the selected index HTML", async () => {
    const html = "<html><head></head><body>compiled</body></html>";
    fs.writeFileSync(join(projectDir, "index.html"), "project");
    fs.writeFileSync(join(compiledDir, "index.html"), html);
    fs.writeFileSync(join(compiledDir, "other.html"), html);
    server = await createFileServer({
      projectDir,
      compiledDir,
      headScripts: ["window.headTest = 1;"],
      bodyScripts: ["window.bodyTest = 1;"],
    });
    const response = await fetch(server.url);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const text = await response.text();
    expect(text).toContain("compiled");
    expect(text).toContain("window.headTest = 1;");
    expect(text).toContain("window.bodyTest = 1;");
    expect(await (await fetch(`${server.url}/other.html`)).text()).toBe(html);
    expectClosed();
  });

  it.each(["stat", "read"])("closes the selected file when %s fails", async (step) => {
    fs.writeFileSync(join(projectDir, "file.bin"), "bytes");
    const fail = () => {
      throw new Error("Injected failure");
    };
    if (step === "stat") hooks.checked = fail;
    else hooks.beforeRead = fail;
    vi.spyOn(console, "error").mockImplementation(() => {});
    server = await createFileServer({ projectDir });
    expect((await fetch(`${server.url}/file.bin`)).status).toBe(500);
    expectClosed();
  });
});
