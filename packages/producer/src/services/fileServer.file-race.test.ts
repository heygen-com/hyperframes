import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileServer, type FileServerHandle } from "./fileServer.js";

const hooks = vi.hoisted(() => ({
  checked: (_path: fs.PathLike) => {},
  beforeRead: () => {},
  opened: new Map<number, fs.PathLike>(),
  active: new Set<number>(),
  failStream: false,
  failCreation: false,
  streams: new Array<fs.ReadStream>(),
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
    readFile: (
      path: fs.PathOrFileDescriptor,
      encoding: BufferEncoding,
      callback: (error: NodeJS.ErrnoException | null, data?: string) => void,
    ) => {
      try {
        hooks.beforeRead();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      actual.readFile(path, encoding, callback);
    },
    createReadStream: (path: fs.PathLike, options?: Parameters<typeof fs.createReadStream>[1]) => {
      if (hooks.failCreation) throw new Error("Injected stream construction failure");
      const stream = actual.createReadStream(path, options);
      hooks.streams.push(stream);
      const fd = typeof options === "object" ? options.fd : undefined;
      if (typeof fd === "number") stream.on("close", () => hooks.active.delete(fd));
      if (hooks.failStream)
        queueMicrotask(() => stream.destroy(new Error("Injected stream failure")));
      return stream;
    },
  };
});

describe("producer file server checked reads", () => {
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
    hooks.streams = [];
    hooks.failStream = false;
    hooks.failCreation = false;
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    hooks.checked = () => {};
    hooks.beforeRead = () => {};
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function expectClosed() {
    // HTTP sockets can reuse an already-closed fd before fetch resolves.
    // Track successful real closes instead of probing stale descriptor numbers.
    expect(hooks.opened.size).toBeGreaterThan(0);
    await vi.waitFor(() => expect(hooks.active.size).toBe(0));
  }

  it.each([
    ["project", "html"],
    ["project", "bin"],
    ["project", "range"],
    ["compiled", "html"],
    ["compiled", "bin"],
    ["compiled", "range"],
  ])("reads the checked %s .%s despite replacement", async (source, ext) => {
    const name = `asset.${ext === "range" ? "bin" : ext}`;
    const file = join(source === "compiled" ? compiledDir : projectDir, name);
    fs.writeFileSync(join(projectDir, name), "project bytes");
    fs.writeFileSync(file, "checked bytes");
    hooks.checked = (path) => {
      if (path !== file) return;
      hooks.checked = () => {};
      fs.renameSync(file, join(root, "original"));
      fs.writeFileSync(file, "replacement bytes");
    };
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir, compiledDir });
    const response = await fetch(
      `${server.url}/${name}`,
      ext === "range" ? { headers: { Range: "bytes=1-4" } } : {},
    );
    expect(response.status).toBe(ext === "range" ? 206 : 200);
    if (ext === "range") {
      expect(response.headers.get("content-range")).toBe("bytes 1-4/13");
      expect(await response.text()).toBe("heck");
    } else {
      expect(await response.text()).toContain("checked bytes");
      if (ext === "bin") expect(response.headers.get("content-length")).toBe("13");
    }
    await expectClosed();
  });

  it.each(["missing", "directory", "non-directory parent"])(
    "falls back from a compiled %s",
    async (kind) => {
      fs.mkdirSync(join(projectDir, "assets"));
      fs.writeFileSync(join(projectDir, "assets", "file.bin"), "project bytes");
      if (kind === "directory")
        fs.mkdirSync(join(compiledDir, "assets", "file.bin"), { recursive: true });
      if (kind === "non-directory parent") fs.writeFileSync(join(compiledDir, "assets"), "blocker");
      server = await createFileServer({
        headScripts: [],
        bodyScripts: [],
        projectDir,
        compiledDir,
      });
      const response = await fetch(`${server.url}/assets/file.bin`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("project bytes");
      await expectClosed();
    },
  );

  it.skipIf(process.platform === "win32")("skips a compiled FIFO without blocking", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "project bytes");
    execFileSync("mkfifo", [join(compiledDir, "file.bin")]);
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir, compiledDir });
    const response = await fetch(`${server.url}/file.bin`);
    expect(await response.text()).toBe("project bytes");
    await expectClosed();
  });

  it.skipIf(process.platform === "win32")("falls back from a compiled Unix socket", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "project bytes");
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(join(compiledDir, "file.bin"), resolve));
    try {
      server = await createFileServer({
        headScripts: [],
        bodyScripts: [],
        projectDir,
        compiledDir,
      });
      const response = await fetch(`${server.url}/file.bin`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("project bytes");
      await expectClosed();
    } finally {
      await new Promise<void>((resolve, reject) =>
        socket.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("serves an empty compiled file instead of falling back", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "project bytes");
    fs.writeFileSync(join(compiledDir, "file.bin"), "");
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir, compiledDir });
    const response = await fetch(`${server.url}/file.bin`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    await expectClosed();
  });

  it("continues serving symlinked assets", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "project bytes");
    fs.symlinkSync(
      projectDir,
      join(compiledDir, "assets"),
      process.platform === "win32" ? "junction" : "dir",
    );
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir, compiledDir });
    const response = await fetch(`${server.url}/assets/file.bin`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("project bytes");
    await expectClosed();
  });

  it("keeps missing files and directories at 404", async () => {
    fs.mkdirSync(join(projectDir, "folder"));
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
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
    const other = await (await fetch(`${server.url}/other.html`)).text();
    expect(other).toContain("compiled");
    expect(other).not.toContain("window.headTest = 1;");
    expect(other).not.toContain("window.bodyTest = 1;");
    await expectClosed();
  });

  it.each(["full", "range"])("closes a %s stream after a read error", async (kind) => {
    fs.writeFileSync(join(projectDir, "file.bin"), "checked bytes");
    hooks.failStream = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
    const url = server.url;
    await expect(async () => {
      const response = await fetch(
        `${url}/file.bin`,
        kind === "range" ? { headers: { Range: "bytes=1-4" } } : {},
      );
      await response.arrayBuffer();
    }).rejects.toThrow();
    await expectClosed();
  });

  it.each(["creation", "conversion"])(
    "closes the descriptor after stream %s fails",
    async (stage) => {
      fs.writeFileSync(join(projectDir, "file.bin"), "checked bytes");
      if (stage === "creation") hooks.failCreation = true;
      else
        vi.spyOn(Readable, "toWeb").mockImplementationOnce(() => {
          throw new Error("Injected conversion failure");
        });
      vi.spyOn(console, "error").mockImplementation(() => {});
      server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
      expect((await fetch(`${server.url}/file.bin`)).status).toBe(500);
      await expectClosed();
    },
  );

  it.each(["full", "range"])("closes a %s stream when the client cancels", async (kind) => {
    const file = join(projectDir, "file.bin");
    fs.writeFileSync(file, "");
    fs.truncateSync(file, 32 * 1024 * 1024);
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
    const response = await fetch(
      `${server.url}/file.bin`,
      kind === "range" ? { headers: { Range: "bytes=1-" } } : {},
    );
    expect(response.status).toBe(kind === "range" ? 206 : 200);
    await response.body?.cancel();
    await expectClosed();
  });

  it.each(["full", "range", "unsatisfiable"])(
    "closes a %s HEAD response without creating a stream",
    async (kind) => {
      fs.writeFileSync(join(projectDir, "file.bin"), "checked bytes");
      server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
      const response = await fetch(`${server.url}/file.bin`, {
        method: "HEAD",
        headers: kind === "full" ? {} : { Range: kind === "range" ? "bytes=1-4" : "bytes=99-" },
      });
      expect(response.status).toBe(kind === "full" ? 200 : kind === "range" ? 206 : 416);
      expect(await response.text()).toBe("");
      expect(hooks.streams).toHaveLength(0);
      await expectClosed();
    },
  );

  it("closes an unsatisfiable GET without creating a stream", async () => {
    fs.writeFileSync(join(projectDir, "file.bin"), "checked bytes");
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
    const response = await fetch(`${server.url}/file.bin`, { headers: { Range: "bytes=99-" } });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */13");
    expect(hooks.streams).toHaveLength(0);
    await expectClosed();
  });

  it.each(["stat", "read"])("closes the selected file when %s fails", async (step) => {
    fs.writeFileSync(join(projectDir, "file.html"), "bytes");
    const fail = () => {
      throw new Error("Injected failure");
    };
    if (step === "stat") hooks.checked = fail;
    else hooks.beforeRead = fail;
    vi.spyOn(console, "error").mockImplementation(() => {});
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
    expect((await fetch(`${server.url}/file.html`)).status).toBe(500);
    await expectClosed();
  });
});
