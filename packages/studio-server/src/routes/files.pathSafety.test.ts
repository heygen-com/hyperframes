import { afterEach, describe, expect, it, vi, type TestContext } from "vitest";
import { Hono } from "hono";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { registerFileRoutes } from "./files";
import { createStudioApi } from "../createStudioApi";
import { fileContentVersion } from "../helpers/fileVersion";
import { ProjectRootMissingError } from "@hyperframes/core";
import { mkdirWithinProject } from "../helpers/safePath";
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
  return { app, project, outside, adapter };
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

async function expectProjectGone(response: Response, project: string) {
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
  expect(existsSync(project)).toBe(false);
}

describe("file route containment", () => {
  it("writes the file a link resolves to when its target climbs out of a linked folder", async (context) => {
    const { app, project } = fixture();
    mkdirSync(join(project, "deep", "nested"), { recursive: true });
    mkdirSync(join(project, "m"));
    writeFileSync(join(project, "deep", "y.txt"), "old");
    writeFileSync(join(project, "y.txt"), "decoy");
    linkOrSkip(context, join(project, "deep", "nested"), join(project, "sub"), "dir");
    linkOrSkip(context, "../sub/../y.txt", join(project, "m", "x.txt"), "file");

    const response = await app.request(fileUrl("m/x.txt"), {
      method: "PUT",
      headers: { "If-Match": fileContentVersion("old") },
      body: "new",
    });

    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "deep", "y.txt"), "utf8")).toBe("new");
    expect(readFileSync(join(project, "y.txt"), "utf8")).toBe("decoy");
  });

  it("refuses a write through a link whose target climbs out of a folder linked outside", async (context) => {
    const { app, project, outside } = fixture();
    mkdirSync(join(outside, "a", "b"), { recursive: true });
    mkdirSync(join(project, "m"));
    writeFileSync(join(outside, "a", "y.txt"), "outside secret");
    writeFileSync(join(project, "y.txt"), "decoy");
    linkOrSkip(context, join(outside, "a", "b"), join(project, "sub"), "dir");
    linkOrSkip(context, "../sub/../y.txt", join(project, "m", "x.txt"), "file");

    const response = await app.request(fileUrl("m/x.txt"), {
      method: "PUT",
      headers: { "If-Match": fileContentVersion("outside secret") },
      body: "overwrite",
    });

    expect(response.status).toBe(403);
    expect(readFileSync(join(outside, "a", "y.txt"), "utf8")).toBe("outside secret");
    expect(readFileSync(join(project, "y.txt"), "utf8")).toBe("decoy");
  });

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

describe("resolveProjectPath why", () => {
  // The CLI host's `resolveProject` is static — it answers with this project
  // for as long as the server runs, even after its folder is renamed or
  // deleted. Before this fix that produced a 403 "forbidden" (isSafePath
  // fails closed when its base doesn't exist), indistinguishable from a real
  // path-traversal attempt. This must be a 404 with its own `why`, checked
  // BEFORE the NUL/traversal checks so it wins when both are true.
  it("does not recreate a project folder renamed away while Studio has it open", async () => {
    const { project, adapter } = fixture();
    const api = createStudioApi({
      ...adapter,
      rendersDir: () => join(project, "renders"),
      installRegistryBlock: async () => {
        mkdirWithinProject(project, join(project, "compositions"));
        return { written: [] };
      },
    });
    const render = () =>
      api.request("http://localhost/projects/demo/render", { method: "POST", body: "{}" });
    renameSync(project, `${project}-renamed`);

    const save = await api.request(fileUrl("scenes/intro.html"), {
      method: "PUT",
      headers: { "If-None-Match": "*" },
      body: "<html></html>",
    });
    const form = new FormData();
    form.append("files", new File(["upload bytes"], "clip.txt"));
    const upload = await api.request("http://localhost/projects/demo/upload?dir=assets", {
      method: "POST",
      body: form,
    });
    const install = await api.request("http://localhost/projects/demo/registry/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockName: "card" }),
    });

    for (const response of [save, upload, install, await render()]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
    }
    expect(existsSync(project)).toBe(false);
  });

  it("answers that the project folder is gone when it is renamed while an upload is being read", async () => {
    const { project, adapter } = fixture();
    const readForm = Request.prototype.formData;
    vi.spyOn(Request.prototype, "formData").mockImplementation(function (this: Request) {
      renameSync(project, `${project}-renamed`);
      return readForm.call(this);
    });

    await expectProjectGone(await upload(createStudioApi(adapter)), project);
  });

  describe.each([
    ["a host that keeps resolving the project", (adapter: StudioApiAdapter) => adapter],
    [
      "a host that stops resolving a vanished project",
      (adapter: StudioApiAdapter): StudioApiAdapter => ({
        ...adapter,
        resolveProject: async (id) => {
          const project = await adapter.resolveProject(id);
          return project && existsSync(project.dir) ? project : null;
        },
      }),
    ],
  ])("on %s", (_, host) => {
    function vanishWhileReading(
      read: "arrayBuffer" | "text",
      method: string,
      route: string,
      body: string,
    ) {
      const { project, adapter } = fixture();
      const readBody = Request.prototype[read];
      vi.spyOn(Request.prototype, read).mockImplementation(function (this: Request) {
        renameSync(project, `${project}-renamed`);
        return readBody.call(this);
      });
      const response = createStudioApi(host(adapter)).request(
        `http://localhost/projects/demo/${route}`,
        {
          method,
          headers: { "Content-Type": "application/json", "If-Match": fileContentVersion("inside") },
          body,
        },
      );
      return { project, response };
    }

    it.each([
      ["a save", "arrayBuffer", "PUT", "files/inside.txt", "new"],
      ["a rename", "text", "PATCH", "files/inside.txt", JSON.stringify({ newPath: "moved.txt" })],
      ["a duplicate", "text", "POST", "duplicate-file", JSON.stringify({ path: "inside.txt" })],
      [
        "a render that names a composition",
        "text",
        "POST",
        "render",
        JSON.stringify({ composition: "index.html" }),
      ],
    ] as const)(
      "answers that the project folder is gone when it vanishes while %s reads its body",
      async (_, read, method, route, body) => {
        const { project, response } = vanishWhileReading(read, method, route, body);
        await expectProjectGone(await response, project);
      },
    );

    it("keeps a malformed request's 400 when the folder vanishes", async () => {
      const { response } = vanishWhileReading("text", "PATCH", "files/inside.txt", "{}");
      expect((await response).status).toBe(400);
    });

    it("keeps a save conflict's 409 while the folder is there", async () => {
      const { adapter } = fixture();
      const response = await createStudioApi(host(adapter)).request(fileUrl("inside.txt"), {
        method: "PUT",
        headers: { "If-Match": fileContentVersion("stale") },
        body: "new",
      });
      expect(response.status).toBe(409);
    });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps a route's error when the project folder is there but cannot be looked at",
    async () => {
      const { project, adapter } = fixture();
      const api = createStudioApi(adapter);
      api.get("/projects/:id/broken", () => {
        throw new Error("read failed");
      });
      chmodSync(join(project, ".."), 0o000);
      try {
        expect((await api.request("http://localhost/projects/demo/broken")).status).toBe(500);
      } finally {
        chmodSync(join(project, ".."), 0o700);
      }
    },
  );

  it.each([
    ["an error after the folder vanished", () => new Error("read failed"), true],
    ["the missing-folder error", () => new ProjectRootMissingError("gone"), false],
  ])(
    "keeps the host's headers but not the route's on the 404 when a route throws %s",
    async (_, error, removeFolder) => {
      const { project, adapter } = fixture();
      const api = createStudioApi(adapter);
      api.get("/projects/:id/cached", (c) => {
        c.header("ETag", '"thumb"');
        throw error();
      });
      const host = new Hono();
      host.use(async (c, next) => {
        c.header("Access-Control-Allow-Origin", "*");
        await next();
      });
      host.route("/api", api);
      if (removeFolder) rmSync(project, { recursive: true, force: true });

      const response = await host.request("http://localhost/api/projects/demo/cached");

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
      expect(response.headers.get("ETag")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    },
  );

  it("does not start a render into an outside folder once the project folder is gone", async () => {
    const { project, adapter } = fixture();
    const startRender = vi.fn(adapter.startRender);
    const api = createStudioApi({ ...adapter, startRender });
    rmSync(project, { recursive: true, force: true });

    const response = await api.request("http://localhost/projects/demo/render", {
      method: "POST",
      body: "{}",
    });

    await expectProjectGone(response, project);
    expect(startRender).not.toHaveBeenCalled();
    expect(existsSync(adapter.rendersDir({ id: "demo", dir: project }))).toBe(false);
  });

  it("refuses a render composition that leaves a symlinked project folder through ..", async (context) => {
    const { project, adapter } = fixture();
    const root = join(project, "..");
    mkdirSync(join(root, "data"));
    renameSync(project, join(root, "data", "project"));
    mkdirSync(join(root, "home", "project"), { recursive: true });
    writeFileSync(join(root, "home", "project", "secret.html"), "<html></html>");
    linkOrSkip(context, join(root, "data", "project"), join(root, "home", "link"), "dir");
    const startRender = vi.fn(adapter.startRender);
    const api = createStudioApi({
      ...adapter,
      resolveProject: async (id) => ({ id, dir: join(root, "home", "link") }),
      startRender,
    });

    const response = await api.request("http://localhost/projects/demo/render", {
      method: "POST",
      body: JSON.stringify({ composition: "../project/secret.html" }),
    });

    expect(response.status).toBe(400);
    expect(startRender).not.toHaveBeenCalled();
  });

  it("reports a missing project directory as 404, not 403", async () => {
    const { app, project } = fixture();
    rmSync(project, { recursive: true, force: true });

    const response = await app.request(fileUrl("inside.txt"));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
  });

  it("still reports a NUL byte as 403 with its own why when the project exists", async () => {
    const response = await fixture().app.request(fileUrl("inside.txt\0"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ why: "nul" });
  });

  it("still reports an escaping path as 403 with its own why when the project exists", async () => {
    const { app, project, outside } = fixture();

    const response = await app.request(fileUrl(relative(project, join(outside, "secret.txt"))));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ why: "outside_project" });
  });

  // A listing (`walkDir`) can show a path that has since been replaced by a
  // directory — a rename, or an agent overwriting a file with a folder of the
  // same name. `existsSync` passes; `readFileSync` would throw `EISDIR`, which
  // Hono answers as plain-text "Internal Server Error" — not JSON, and not a
  // reason. This must read the same as any other missing-file 404.
  it("reports a path replaced by a directory as 404, not a bare server error", async () => {
    const { app, project } = fixture();
    rmSync(join(project, "inside.txt"));
    mkdirSync(join(project, "inside.txt"));

    const response = await app.request(fileUrl("inside.txt"));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "not_a_file" });
  });

  // The dangling case: the link exists, its target does not, anywhere. This is
  // broken plumbing (a stale symlink), not an attack — the read route should
  // say so rather than reuse the path-traversal label.
  it("reports a dangling symlink as 404, not 403", async (context) => {
    const { app, project } = fixture();
    linkOrSkip(context, join(project, "nope-target.html"), join(project, "dangling.html"), "file");

    const response = await app.request(fileUrl("dangling.html"));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "dangling_symlink" });
  });

  // The containment guard must not weaken: a symlink that resolves to
  // something real outside the project is still the traversal case, whether
  // or not it happens to be broken in some OTHER way. Only a target that
  // exists nowhere gets the new label.
  it("still reports a symlink resolving outside the project as 403 outside_project", async (context) => {
    const { app, project, outside } = fixture();
    linkOrSkip(context, join(outside, "secret.txt"), join(project, "escape.html"), "file");

    const response = await app.request(fileUrl("escape.html"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ why: "outside_project" });
  });

  // The "dangling_symlink" label must never apply to a path whose *own*
  // location is outside the project (reached via `..`) — only to a symlink
  // that lives inside the project. Otherwise the response leaks, to anyone
  // who can hit the route, whether an out-of-project path happens to be a
  // dangling symlink, which is exactly the containment guard's job to hide.
  it("reports a dangling symlink reached by traversal as 403, not 404", async (context) => {
    const { app, project, outside } = fixture();
    linkOrSkip(context, join(outside, "nope-target.html"), join(outside, "dangling.html"), "file");

    const response = await app.request(fileUrl(relative(project, join(outside, "dangling.html"))));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ why: "outside_project" });
  });

  // Same leak, one level removed: the leaf name is lexically inside the
  // project, but it's reached through a directory symlink that itself
  // escapes the project. The dangling-ness of the leaf must not surface.
  it("reports a dangling leaf behind an escaping directory symlink as 403, not 404", async (context) => {
    const { app, project, outside } = fixture();
    linkOrSkip(context, outside, join(project, "ext"), "dir");

    const response = await app.request(fileUrl("ext/nope-target.html"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ why: "outside_project" });
  });

  // A symlink that lives inside the project but points *outside* it must
  // read identically (403, same why) whether or not the outside target
  // exists — the existence of an outside file is exactly what containment
  // must never reveal, and `dangling_symlink` is a 404 an attacker could
  // otherwise use to probe it.
  it("does not distinguish an existing from a missing target across the project boundary", async (context) => {
    const { app, project, outside } = fixture();
    writeFileSync(join(outside, "b-target.txt"), "outside b");
    linkOrSkip(context, join(outside, "a-missing.txt"), join(project, "a.html"), "file");
    linkOrSkip(context, join(outside, "b-target.txt"), join(project, "b.html"), "file");

    const [toMissing, toExisting] = await Promise.all([
      app.request(fileUrl("a.html")),
      app.request(fileUrl("b.html")),
    ]);

    expect(toMissing.status).toBe(toExisting.status);
    expect(await toMissing.json()).toMatchObject({ why: "outside_project" });
    expect(await toExisting.json()).toMatchObject({ why: "outside_project" });
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

  it("answers that the project folder is gone when it is renamed while a file is read", async () => {
    const { app, project } = fixture();
    raceDuringRead("upload.txt", () => renameSync(project, `${project}-renamed`));
    await expectProjectGone(await upload(app), project);
  });
});

describe("rename reference updates", () => {
  const renameInside = (app: Hono) =>
    app.request(fileUrl("inside.txt"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath: "moved.txt" }),
    });

  // Windows and root read every folder, so the rename never meets one it may not read there.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "a rename past an unreadable folder or file still answers ok and updates what it can read",
    async () => {
      const { app, project } = fixture();
      writeFileSync(join(project, "index.html"), '<img src="inside.txt">');
      mkdirSync(join(project, "private"));
      writeFileSync(join(project, "locked.html"), '<img src="inside.txt">');
      chmodSync(join(project, "private"), 0o000);
      chmodSync(join(project, "locked.html"), 0o000);
      try {
        expect(() => readdirSync(join(project, "private"))).toThrow(/EACCES|EPERM/);
        const rename = await renameInside(app);
        expect(rename.status).toBe(200);
        expect(existsSync(join(project, "inside.txt"))).toBe(false);
        expect(readFileSync(join(project, "moved.txt"), "utf8")).toBe("inside");
        expect(readFileSync(join(project, "index.html"), "utf8")).toBe('<img src="moved.txt">');
      } finally {
        chmodSync(join(project, "private"), 0o755);
        chmodSync(join(project, "locked.html"), 0o644);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "a rename whose reference scan fails for another reason still says so",
    async () => {
      const { app, project } = fixture();
      // A link named like a text file that leads to a folder: reading it fails, and not for want of permission.
      mkdirSync(join(project, "folder"));
      symlinkSync(join(project, "folder"), join(project, "link.html"), "dir");
      const rename = await renameInside(app);
      expect(rename.status).toBe(500);
    },
  );
});

describe("the desktop app's private files", () => {
  it("are never read, written or deleted through the file routes, however the path is spelled", async (context) => {
    const { app, project } = fixture();
    mkdirSync(join(project, ".hyperframes"));
    writeFileSync(
      join(project, ".hyperframes", "agent-handoff.json"),
      '{"engine":"claude","sessionId":"secret"}',
    );
    writeFileSync(join(project, ".hyperframes", "app-history.jsonl"), '{"said":"secret"}');
    for (const path of [
      ".hyperframes/agent-handoff.json",
      ".hyperframes/app-history.jsonl",
      ".HyperFrames/Agent-Handoff.JSON",
    ]) {
      const res = await app.request(`/projects/p/files/${path}`);
      expect([403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain("secret");
    }
    const put = await app.request("/projects/p/files/.hyperframes/agent-handoff.json", {
      method: "PUT",
      body: "{}",
    });
    expect(put.status).toBe(403);
    const del = await app.request("/projects/p/files/.hyperframes/app-history.jsonl", {
      method: "DELETE",
    });
    expect(del.status).toBe(403);
    linkOrSkip(
      context,
      join(project, ".hyperframes", "agent-handoff.json"),
      join(project, "link.json"),
      "file",
    );
    const viaLink = await app.request("/projects/p/files/link.json");
    expect(await viaLink.text()).not.toContain("secret");
  });

  it("leave the rest of .hyperframes/ to Studio", async () => {
    const { app, project } = fixture();
    mkdirSync(join(project, ".hyperframes", "prepared-assets", "gif"), { recursive: true });
    writeFileSync(
      join(project, ".hyperframes", "studio-motion.json"),
      '{"version":1,"motions":[]}',
    );
    writeFileSync(join(project, ".hyperframes", "prepared-assets", "gif", "a.mp4"), "mp4");
    for (const path of ["studio-motion.json", "prepared-assets/gif/a.mp4"])
      expect((await app.request(`/projects/p/files/.hyperframes/${path}`)).status).toBe(200);
  });
});

describe("routes that write a path from the request", () => {
  it("never plant or copy a file into .hyperframes/", async () => {
    const { app, project } = fixture();
    mkdirSync(join(project, ".hyperframes"));
    writeFileSync(
      join(project, ".hyperframes", "agent-handoff.json"),
      '{"engine":"claude","sessionId":"secret"}',
    );
    const rename = await app.request("/projects/p/files/inside.txt", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: ".hyperframes/app-history.jsonl" }),
    });
    expect(rename.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(project, ".hyperframes", "app-history.jsonl"))).toBe(false);
    const duplicate = await app.request("/projects/p/duplicate-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: ".hyperframes/agent-handoff.json" }),
    });
    expect(duplicate.status).toBeGreaterThanOrEqual(400);
    expect(readdirSync(join(project, ".hyperframes"))).toEqual(["agent-handoff.json"]);
    const form = new FormData();
    form.append("file", new File(['{"said":"t"}'], "app-history.jsonl"));
    const upload = await app.request("/projects/p/upload?dir=.hyperframes", {
      method: "POST",
      body: form,
    });
    expect((await upload.json()).files ?? []).toEqual([]);
    expect(existsSync(join(project, ".hyperframes", "app-history.jsonl"))).toBe(false);
  });
});
