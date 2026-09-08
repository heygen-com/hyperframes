import { afterEach, describe, expect, it, vi, type TestContext } from "vitest";
import { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { registerFileRoutes } from "./files";
import { fileContentVersion } from "../helpers/fileVersion";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hf-file-containment-"));
  tempDirs.push(root);
  const project = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(project);
  mkdirSync(outside);
  writeFileSync(join(project, "inside.txt"), "inside");
  writeFileSync(join(outside, "secret.txt"), "outside secret");
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id) => ({ id, dir: project }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(root, "renders"),
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "out.mp4" }),
  };
  const app = new Hono();
  registerFileRoutes(app, adapter);
  return { app, project, outside };
}

function linkOrSkip(context: TestContext, target: string, link: string, type: "file" | "dir") {
  try {
    symlinkSync(target, link, type);
  } catch (error) {
    if (
      process.platform === "win32" &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))
    ) {
      context.skip("Windows runner does not permit creating symbolic links");
    }
    throw error;
  }
}

const fileUrl = (path: string) =>
  `http://localhost/projects/demo/files/${encodeURIComponent(path)}`;
function upload(app: Hono, dir = "", filename = "upload.txt") {
  const form = new FormData();
  form.append("files", new File(["upload bytes"], filename));
  return app.request(`http://localhost/projects/demo/upload?dir=${encodeURIComponent(dir)}`, {
    method: "POST",
    body: form,
  });
}

describe("file route containment", () => {
  it.each(["GET", "PUT", "POST", "DELETE"])(
    "rejects encoded traversal through %s without changing outside bytes",
    async (method) => {
      const { app, project, outside } = fixture();
      const target = join(outside, "secret.txt");
      const response = await app.request(fileUrl(relative(project, target)), {
        method,
        headers: { "If-Match": fileContentVersion("outside secret") },
        ...(method === "PUT" || method === "POST" ? { body: "overwrite" } : {}),
      });
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("outside secret");
      expect(readFileSync(target, "utf8")).toBe("outside secret");
    },
  );

  it("rejects NUL bytes in read, rename, and duplicate inputs", async () => {
    const { app, project } = fixture();
    expect((await app.request(fileUrl("inside.txt\0"))).status).toBe(403);
    const rename = await app.request(fileUrl("inside.txt"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath: "bad\0.txt" }),
    });
    const duplicate = await app.request("http://localhost/projects/demo/duplicate-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "inside.txt\0" }),
    });
    expect(rename.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(readFileSync(join(project, "inside.txt"), "utf8")).toBe("inside");
  });

  it("rejects escaping rename destinations and duplicate sources", async () => {
    const { app, project, outside } = fixture();
    const rename = await app.request(fileUrl("inside.txt"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath: relative(project, join(outside, "moved.txt")) }),
    });
    const duplicate = await app.request("http://localhost/projects/demo/duplicate-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relative(project, join(outside, "secret.txt")) }),
    });
    expect(rename.status).toBe(403);
    expect(duplicate.status).toBe(404);
    expect(existsSync(join(outside, "moved.txt"))).toBe(false);
    expect(readFileSync(join(project, "inside.txt"), "utf8")).toBe("inside");
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside secret");
  });

  it("blocks reads and uploads through a symlink to an outside directory", async (context) => {
    const { app, project, outside } = fixture();
    linkOrSkip(context, outside, join(project, "alias"), "dir");
    const read = await app.request(fileUrl("alias/secret.txt"));
    expect(read.status).toBe(403);
    expect(await read.text()).not.toContain("outside secret");
    expect((await upload(app, "alias/new")).status).toBe(403);
    expect(existsSync(join(outside, "new"))).toBe(false);
  });

  it("updates internal rename references without following an external file symlink", async (context) => {
    const { app, project, outside } = fixture();
    const external = join(outside, "victim.html");
    const internal = join(project, "index.html");
    writeFileSync(external, "reference: inside.txt");
    writeFileSync(internal, "reference: inside.txt");
    linkOrSkip(context, external, join(project, "external.html"), "file");

    const response = await app.request(fileUrl("inside.txt"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath: "moved.txt" }),
    });

    expect(response.status).toBe(200);
    expect(readFileSync(external, "utf8")).toBe("reference: inside.txt");
    expect(readFileSync(internal, "utf8")).toBe("reference: moved.txt");
    expect(readFileSync(join(project, "moved.txt"), "utf8")).toBe("inside");
    expect(existsSync(join(project, "inside.txt"))).toBe(false);
    expect((await response.json()).updatedReferences).toBe(1);
  });

  it("blocks upload directory traversal and skips unsafe filenames", async () => {
    const { app, project, outside } = fixture();
    expect((await upload(app, relative(project, outside))).status).toBe(403);
    const unsafe = await upload(app, "", "..unsafe.txt");
    expect(unsafe.status).toBe(201);
    expect((await unsafe.json()).files).toEqual([]);
    expect(existsSync(join(outside, "upload.txt"))).toBe(false);
    expect(existsSync(join(project, "..unsafe.txt"))).toBe(false);
  });

  it.each([false, true])(
    "does not follow a dangling upload symlink (renamed: %s)",
    async (collision, context) => {
      const { app, project, outside } = fixture();
      const external = join(outside, "new.txt");
      if (collision) writeFileSync(join(project, "upload.txt"), "existing upload");
      const filename = collision ? "upload (2).txt" : "upload.txt";
      linkOrSkip(context, external, join(project, filename), "file");
      const response = await upload(app);
      expect(response.status).toBe(201);
      expect((await response.json()).files).toEqual([]);
      expect(existsSync(external)).toBe(false);
    },
  );

  it("allows nested file creation, uploads, and internal directory symlinks", async (context) => {
    const { app, project } = fixture();
    const created = await app.request(fileUrl("nested/inside.txt"), {
      method: "PUT",
      headers: { "If-None-Match": "*" },
      body: "nested bytes",
    });
    expect(created.status).toBe(200);
    expect((await (await app.request(fileUrl("nested/inside.txt"))).json()).content).toBe(
      "nested bytes",
    );
    expect((await upload(app, "nested")).status).toBe(201);
    expect(readFileSync(join(project, "nested/upload.txt"), "utf8")).toBe("upload bytes");
    linkOrSkip(context, join(project, "nested"), join(project, "alias"), "dir");
    expect((await (await app.request(fileUrl("alias/inside.txt"))).json()).content).toBe(
      "nested bytes",
    );
  });
});

describe("upload collision races", () => {
  function raceDuringRead(filename: string, collide: () => void) {
    const file = new File(["new upload"], filename);
    const read = file.arrayBuffer.bind(file);
    vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
      collide();
      return read();
    });
    const form = new FormData();
    form.append("files", file);
    vi.spyOn(Request.prototype, "formData").mockResolvedValue(form);
  }

  it("preserves an upload that appears while the body is read", async () => {
    const { app, project } = fixture();
    raceDuringRead("upload.txt", () => writeFileSync(join(project, "upload.txt"), "other upload"));
    const response = await upload(app);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ files: ["upload (2).txt"] });
    expect(readFileSync(join(project, "upload.txt"), "utf8")).toBe("other upload");
    expect(readFileSync(join(project, "upload (2).txt"), "utf8")).toBe("new upload");
  });

  it.each([".gitignore", "archive.tar.txt"])(
    "retries suffix races without changing extension rules: %s",
    async (name) => {
      const { app, project } = fixture();
      const dot = name.indexOf(".", name.startsWith(".") ? 1 : 0);
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      writeFileSync(join(project, name), "original");
      raceDuringRead(name, () => {
        writeFileSync(join(project, `${base} (2)${ext}`), "second");
        writeFileSync(join(project, `${base} (3)${ext}`), "third");
      });
      const response = await upload(app, "", name);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ files: [`${base} (4)${ext}`] });
      expect(readFileSync(join(project, `${base} (2)${ext}`), "utf8")).toBe("second");
      expect(readFileSync(join(project, `${base} (3)${ext}`), "utf8")).toBe("third");
    },
  );

  it("does not write through a symlink planted during the upload read", async (context) => {
    const { app, project, outside } = fixture();
    // Establish symlink support before entering the mocked asynchronous read.
    const probe = join(project, "probe-link");
    linkOrSkip(context, join(outside, "secret.txt"), probe, "file");
    rmSync(probe);
    raceDuringRead("upload.txt", () =>
      symlinkSync(join(outside, "secret.txt"), join(project, "upload.txt")),
    );
    const response = await upload(app);
    expect(await response.json()).toMatchObject({ files: [] });
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside secret");
  });
});
