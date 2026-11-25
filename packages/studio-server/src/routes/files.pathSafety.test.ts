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
import {
  isPrivateProjectPath,
  isWritableProjectPath,
  mkdirWithinProject,
} from "../helpers/safePath";
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

  it("lists the files a rename leaves pointing at the old path", async () => {
    const { app, project } = fixture();
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ scripts: { gen: "node gen.js" } }),
    );
    writeFileSync(join(project, "index.html"), '<img src="inside.txt">');
    writeFileSync(join(project, "reference.js"), 'load("inside.txt");');
    writeFileSync(join(project, "other.js"), 'load("else.txt");');

    const response = await app.request(fileUrl("inside.txt"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath: "moved.txt" }),
    });

    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe('<img src="moved.txt">');
    expect(readFileSync(join(project, "reference.js"), "utf8")).toBe('load("inside.txt");');
    expect(await response.json()).toMatchObject({
      updatedReferences: 1,
      unchangedReferences: ["reference.js"],
    });
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

describe("files other programs run or trust", () => {
  const TRUSTED = [
    "package.json",
    "Package.JSON",
    "hyperframes.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "vite.config.ts",
    "AGENTS.md",
    "compositions/CLAUDE.md",
    "deep/nested/GEMINI.md",
    "scripts/postinstall.sh",
    "tools/run.py",
    "PACKAG~1.JSO",
    "package.json.",
    "AGENT\u017f.md",
    "package.j\u017fon",
    "run.\u017fh",
    "Make\ufb01le",
    "jest.config.json",
    "binding.gyp",
    "BINDING.GYP.",
    "deps/common.gypi",
    "server.js",
    "Server.JS",
  ];
  const put = (app: Hono, path: string, headers: Record<string, string> = {}) =>
    app.request(fileUrl(path), { method: "PUT", headers, body: "planted" });

  it.each(TRUSTED)("never creates, renames onto or duplicates onto %s", async (path) => {
    const { app, project } = fixture();
    expect((await put(app, path, { "If-None-Match": "*" })).status).toBe(403);
    expect((await app.request(fileUrl(path), { method: "POST", body: "planted" })).status).toBe(
      403,
    );
    const rename = await app.request(fileUrl("inside.txt"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: path }),
    });
    expect(rename.status).toBe(403);
    expect(existsSync(join(project, path))).toBe(false);
    expect(readFileSync(join(project, "inside.txt"), "utf8")).toBe("inside");
    const name = path.split("/").at(-1)!;
    const uploaded = await upload(app, "", name);
    expect(uploaded.status).toBe(201);
    // The route reads a multipart file name as Latin-1, so only an ASCII name arrives as written.
    if (/^[\x20-\x7e]+$/.test(name)) expect((await uploaded.json()).skipped).toContain(name);
    expect(existsSync(join(project, name))).toBe(false);
  });

  it("never overwrites, deletes or renames the project's own package.json or AGENTS.md", async () => {
    const { app, project } = fixture();
    writeFileSync(join(project, "package.json"), '{"name":"mine"}');
    mkdirSync(join(project, "docs"));
    writeFileSync(join(project, "docs", "AGENTS.md"), "mine");
    const read = await app.request(fileUrl("package.json"));
    expect(read.status).toBe(200);
    const overwrite = await put(app, "package.json", {
      "If-Match": fileContentVersion('{"name":"mine"}'),
    });
    expect(overwrite.status).toBe(403);
    expect((await app.request(fileUrl("package.json"), { method: "DELETE" })).status).toBe(403);
    const moveAway = await app.request(fileUrl("docs/AGENTS.md"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: "docs/notes.md" }),
    });
    expect(moveAway.status).toBe(403);
    expect(readFileSync(join(project, "package.json"), "utf8")).toBe('{"name":"mine"}');
    expect(readFileSync(join(project, "docs", "AGENTS.md"), "utf8")).toBe("mine");
  });

  it("refuses to delete or move a folder that holds one, and still does both for an ordinary folder", async () => {
    const { app, project } = fixture();
    mkdirSync(join(project, "tools", "bin"), { recursive: true });
    writeFileSync(join(project, "tools", "bin", "setup.sh"), "echo mine");
    writeFileSync(join(project, "tools", "readme.txt"), "mine");
    expect((await app.request(fileUrl("tools"), { method: "DELETE" })).status).toBe(403);
    const move = await app.request(fileUrl("tools"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: "elsewhere" }),
    });
    expect(move.status).toBe(403);
    expect(readFileSync(join(project, "tools", "bin", "setup.sh"), "utf8")).toBe("echo mine");

    for (const kept of ["vendor/lib/node_modules", "vendor/.git"]) {
      mkdirSync(join(project, kept), { recursive: true });
      expect((await app.request(fileUrl("vendor"), { method: "DELETE" })).status).toBe(403);
      rmSync(join(project, kept), { recursive: true });
    }

    mkdirSync(join(project, "scenes"));
    writeFileSync(join(project, "scenes", "a.html"), "<div></div>");
    const moved = await app.request(fileUrl("scenes"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: "compositions" }),
    });
    expect(moved.status).toBe(200);
    expect((await app.request(fileUrl("compositions"), { method: "DELETE" })).status).toBe(200);
    expect(existsSync(join(project, "compositions"))).toBe(false);
  });

  describe("scripts Node tooling may run", () => {
    const move = (app: Hono, from: string, newPath: string) =>
      app.request(fileUrl(from), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
    const plant = (project: string, file: string, content = "mine") => {
      mkdirSync(join(project, file, ".."), { recursive: true });
      writeFileSync(join(project, file), content);
    };
    const manifest = (project: string, folder: string, pkg: object) =>
      plant(project, join(folder, "package.json"), JSON.stringify(pkg));
    const SCAFFOLD = {
      name: "demo",
      private: true,
      type: "module",
      scripts: {
        dev: "npx --yes hyperframes@0.9.0 preview",
        check: "npx --yes hyperframes lint && npx --yes hyperframes validate",
        render: "npx --yes hyperframes@0.9.0 render",
        publish: "npx --yes hyperframes@0.9.0 publish",
      },
    };
    const expectRefused = async (response: Response, what: string) => {
      expect(response.status, what).toBe(403);
      expect(await response.json(), what).toMatchObject({ why: "protected_path" });
    };

    // Each project runs `target` without package.json spelling it root-relative with its extension.
    const PROJECTS = [
      {
        name: "a script run after a directory change",
        target: "tools/build.js",
        setup: (project: string) =>
          manifest(project, "", { scripts: { build: "cd tools && node build.js" } }),
      },
      {
        name: "an entry named without its extension",
        target: "server/start.js",
        setup: (project: string) =>
          manifest(project, "", { main: "server/start", scripts: { start: "node ." } }),
      },
      {
        name: "a nested package.json script",
        target: "tools/gen.mjs",
        setup: (project: string) => {
          manifest(project, "", SCAFFOLD);
          manifest(project, "tools", { scripts: { gen: "node gen.mjs" } });
        },
      },
      {
        name: "a module a named script imports",
        target: "scripts/helpers.js",
        setup: (project: string) => {
          manifest(project, "", { scripts: { build: "node scripts/build.mjs" } });
          plant(project, "scripts/build.mjs", 'import "./helpers.js";');
        },
      },
    ];

    it.each(PROJECTS)(
      "refuses to overwrite, delete, rename onto or move a folder over $name",
      async ({ target, setup }) => {
        const { app, project } = fixture();
        setup(project);
        plant(project, target);
        const folder = target.split("/")[0]!;
        const name = target.split("/").at(-1)!;

        const overwrite = await app.request(fileUrl(target), {
          method: "PUT",
          headers: { "If-Match": fileContentVersion("mine") },
          body: "planted",
        });
        await expectRefused(overwrite, "overwrite");
        await expectRefused(await app.request(fileUrl(target), { method: "DELETE" }), "delete");
        await expectRefused(await move(app, "inside.txt", target), "rename onto");
        await expectRefused(
          await app.request(fileUrl(folder), { method: "DELETE" }),
          "folder delete",
        );
        await expectRefused(await move(app, folder, `${folder}-aside`), "folder move away");
        plant(project, `incoming/${name}`, "planted");
        await expectRefused(await move(app, "incoming", `${folder}/incoming`), "folder move in");
        const duplicate = await app.request("http://localhost/projects/demo/duplicate-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: target }),
        });
        expect(duplicate.status, "duplicate").toBe(403);
        rmSync(join(project, target));
        const uploaded = await upload(app, target.slice(0, -name.length - 1), name);
        expect((await uploaded.json()).skipped, "upload").toContain(name);
        expect(existsSync(join(project, target)), "upload").toBe(false);
        plant(project, target);

        expect(readFileSync(join(project, target), "utf8")).toBe("mine");
        expect(readFileSync(join(project, "inside.txt"), "utf8")).toBe("inside");
        expect(existsSync(join(project, folder, "incoming"))).toBe(false);
      },
    );

    it.each([
      "scenes/motion.ts",
      "lib/util.cts",
      "lib/util.mts",
      "ui/card.tsx",
      "ui/card.jsx",
      "lib/old.cjs",
    ])("never writes %s, even in a default project", async (path) => {
      const { app, project } = fixture();
      manifest(project, "", SCAFFOLD);
      await expectRefused(
        await app.request(fileUrl(path), { method: "POST", body: "export {}" }),
        "create",
      );
      expect(existsSync(join(project, path))).toBe(false);
    });

    it("still edits composition HTML, CSS and scripts in a default hyperframes init project", async () => {
      const { app, project } = fixture();
      manifest(project, "", SCAFFOLD);
      for (const file of [
        "index.html",
        "style.css",
        "shadows.js",
        "assets/scene.mjs",
        "lib/fx.iife.js",
      ])
        plant(project, file);
      for (const file of [
        "index.html",
        "style.css",
        "shadows.js",
        "assets/scene.mjs",
        "lib/fx.iife.js",
      ]) {
        const saved = await app.request(fileUrl(file), {
          method: "PUT",
          headers: { "If-Match": fileContentVersion("mine") },
          body: "edited",
        });
        expect(saved.status, file).toBe(200);
        expect(readFileSync(join(project, file), "utf8")).toBe("edited");
      }
      expect((await app.request(fileUrl("surface.js"), { method: "POST", body: "x" })).status).toBe(
        201,
      );
      expect((await move(app, "assets", "media/assets")).status).toBe(200);
      expect((await app.request(fileUrl("lib"), { method: "DELETE" })).status).toBe(200);
    });

    it("still edits composition scripts in a project with no package.json", async () => {
      const { app, project } = fixture();
      plant(project, "shadows.js");
      const saved = await app.request(fileUrl("shadows.js"), {
        method: "PUT",
        headers: { "If-Match": fileContentVersion("mine") },
        body: "edited",
      });
      expect(saved.status).toBe(200);
    });

    const create = (app: Hono, path: string) =>
      app.request(fileUrl(path), { method: "POST", body: "planted" });

    // Node loads an exact extensionless name before its `.js`, `.ts` or `.json` sibling.
    const SHADOWS = [
      {
        name: "server/start beside server/start.js, the manifest's main",
        pkg: { main: "server/start", scripts: { start: "node ." } },
        sibling: "server/start.js",
        target: "server/start",
      },
      {
        name: "lib/util beside lib/util.js",
        pkg: { scripts: { build: "node lib/build.js" } },
        sibling: "lib/util.js",
        target: "lib/util",
      },
      {
        name: "lib/util beside lib/util.ts",
        pkg: { devDependencies: { tsx: "^4.0.0" } },
        sibling: "lib/util.ts",
        target: "lib/util",
      },
      {
        name: "config beside config.json",
        pkg: { scripts: { start: "node server.mjs" } },
        sibling: "config.json",
        target: "config",
      },
    ];

    it.each(SHADOWS)("never plants $name", async ({ pkg, sibling, target }) => {
      const { app, project } = fixture();
      manifest(project, "", pkg);
      plant(project, sibling);
      await expectRefused(await create(app, target), "create");
      await expectRefused(await move(app, "inside.txt", target), "rename onto");
      plant(project, "incoming/payload", "planted");
      const parent = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
      await expectRefused(
        await move(app, "incoming", parent ? `${parent}/incoming` : "incoming-moved"),
        "folder move in",
      );
      const uploaded = await upload(app, parent, target.split("/").at(-1)!);
      expect((await uploaded.json()).skipped, "upload").toContain(target.split("/").at(-1));
      expect(existsSync(join(project, target))).toBe(false);
      expect(readFileSync(join(project, "inside.txt"), "utf8")).toBe("inside");
    });

    it.each([
      "server/Start",
      "server/START",
      "server/start.",
      "server/start ",
      "server/\uff53tart",
    ])("refuses %s, a spelling of server/start", async (path) => {
      const { app, project } = fixture();
      manifest(project, "", { main: "server/start" });
      plant(project, "server/start.js");
      await expectRefused(await create(app, path), path);
      expect(readdirSync(join(project, "server"))).toEqual(["start.js"]);
    });

    it("never overwrites, deletes or moves bin/www, an extensionless script package.json runs", async () => {
      const { app, project } = fixture();
      manifest(project, "", { scripts: { start: "node ./bin/www" } });
      plant(project, "bin/www");
      const overwrite = await app.request(fileUrl("bin/www"), {
        method: "PUT",
        headers: { "If-Match": fileContentVersion("mine") },
        body: "planted",
      });
      await expectRefused(overwrite, "overwrite");
      await expectRefused(await app.request(fileUrl("bin/www"), { method: "DELETE" }), "delete");
      await expectRefused(await app.request(fileUrl("bin"), { method: "DELETE" }), "folder delete");
      await expectRefused(await move(app, "bin", "bin-aside"), "folder move away");
      expect(readFileSync(join(project, "bin", "www"), "utf8")).toBe("mine");
    });

    it("still renames, moves and uploads into folders in a project with Node tooling", async () => {
      const { app, project } = fixture();
      manifest(project, "", { main: "server/start", scripts: { start: "node ." } });
      plant(project, "scenes/intro.html", "<div></div>");
      plant(project, "media/logo.png", "png");
      expect((await move(app, "scenes", "compositions")).status).toBe(200);
      expect((await move(app, "media", "assets/media")).status).toBe(200);
      expect((await upload(app, "assets/notes", "credits.txt")).status).toBe(201);
      expect(existsSync(join(project, "assets", "notes", "credits.txt"))).toBe(true);
      expect((await create(app, "compositions/outro.html")).status).toBe(201);
    });

    it("still writes extensionless files in a default hyperframes init project", async () => {
      const { app, project } = fixture();
      manifest(project, "", SCAFFOLD);
      plant(project, "server/start.js");
      expect((await create(app, "server/start")).status).toBe(201);
      expect((await create(app, "notes")).status).toBe(201);
    });

    const slowBody = () => {
      let release = () => {};
      const arrived = new Promise<void>((done) => (release = done));
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("planted"));
          await arrived;
          controller.close();
        },
      });
      return { body, release };
    };
    const startCreate = (app: Hono, path: string, method: "POST" | "PUT") => {
      const { body, release } = slowBody();
      const headers: Record<string, string> = method === "PUT" ? { "If-None-Match": "*" } : {};
      const init = { method, headers, body, duplex: "half" };
      return { answer: app.request(fileUrl(path), init as RequestInit), release };
    };
    const tick = () => new Promise((done) => setTimeout(done, 50));

    it.each(["POST", "PUT"] as const)(
      "a %s create judges the path as a file, whatever folder stands there while its body arrives",
      async (method) => {
        const { app, project } = fixture();
        manifest(project, "", { main: "server/start" });
        plant(project, "server/start.js");
        plant(project, "server/start/keep.txt");
        const { answer, release } = startCreate(app, "server/start", method);
        await tick();
        expect((await app.request(fileUrl("server/start"), { method: "DELETE" })).status).toBe(200);
        release();
        await expectRefused(await answer, method);
        expect(existsSync(join(project, "server", "start"))).toBe(false);
      },
    );

    it.each(["POST", "PUT"] as const)(
      "a %s create is checked again once its body has arrived",
      async (method) => {
        const { app, project } = fixture();
        manifest(project, "", { scripts: { build: "node lib/build.js" } });
        plant(project, "lib/build.js");
        const { answer, release } = startCreate(app, "lib/db.utils", method);
        await tick();
        plant(project, "lib/db.utils.js");
        release();
        await expectRefused(await answer, method);
        expect(readFileSync(join(project, "lib", "db.utils.js"), "utf8")).toBe("mine");
        expect(existsSync(join(project, "lib", "db.utils"))).toBe(false);
      },
    );

    it.each(["db.utils.js", "db.utils.ts", "db.utils.json", "DB.UTILS.JS"])(
      "never plants lib/db.utils beside lib/%s",
      async (sibling) => {
        const { app, project } = fixture();
        manifest(project, "", { scripts: { build: "node lib/build.js" } });
        plant(project, `lib/${sibling}`);
        for (const path of ["lib/db.utils", "lib/DB.Utils", "lib/db.utils.", "lib/db.util\uff53"])
          await expectRefused(await create(app, path), path);
        await expectRefused(await move(app, "inside.txt", "lib/db.utils"), "rename onto");
        plant(project, "incoming/db.utils", "planted");
        plant(project, `incoming/${sibling}`, "{}");
        await expectRefused(await move(app, "incoming", "lib/incoming"), "folder move in");
        const uploaded = await upload(app, "lib", "db.utils");
        expect((await uploaded.json()).skipped, "upload").toContain("db.utils");
        expect(readdirSync(join(project, "lib")).sort()).toEqual([sibling]);
      },
    );

    it("still writes composition assets in a project with Node tooling", async () => {
      const { app, project } = fixture();
      manifest(project, "", { scripts: { build: "node lib/build.js" } });
      plant(project, "lib/build.js");
      for (const path of [
        "index.html",
        "styles/site.css",
        "assets/logo.png",
        "data/points.json",
        "notes.txt",
        "fonts/brand.woff2",
      ])
        expect((await create(app, path)).status, path).toBe(201);
    });

    it("still writes a dotted name beside a module in a default hyperframes init project", async () => {
      const { app, project } = fixture();
      manifest(project, "", SCAFFOLD);
      plant(project, "lib/db.utils.js");
      expect((await create(app, "lib/db.utils")).status).toBe(201);
    });

    it("refuses a folder move that would put config.toml under mise", async () => {
      const { app, project } = fixture();
      plant(project, "cfg/config.toml", "[tasks]");
      for (const [from, to] of [
        ["cfg", "mise"],
        ["cfg", "MISE"],
        ["cfg", "mise."],
        ["cfg", "tools/mise"],
      ] as const) {
        const response = await move(app, from, to);
        expect(response.status, `${from} -> ${to}`).toBe(403);
        expect(await response.json()).toMatchObject({ why: "protected_path" });
      }
      expect(readFileSync(join(project, "cfg", "config.toml"), "utf8")).toBe("[tasks]");
      expect((await move(app, "cfg", "settings")).status).toBe(200);
      expect(readFileSync(join(project, "settings", "config.toml"), "utf8")).toBe("[tasks]");
    });
  });

  describe("a folder holding a received-files record", () => {
    const record = (project: string, folder: string, files: string[]) => {
      mkdirSync(join(project, folder, ".hyperframes"), { recursive: true });
      writeFileSync(
        join(project, folder, ".hyperframes", "received-files.json"),
        JSON.stringify({ files }),
      );
    };
    const move = (app: Hono, from: string, newPath: string) =>
      app.request(fileUrl(from), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPath }),
      });

    it("deletes or moves a folder whose record lists a file outside it", async () => {
      const { app, project } = fixture();
      mkdirSync(join(project, "sub"));
      writeFileSync(join(project, "sub", "page.html"), "<div></div>");
      record(project, "sub/notes", ["../page.html"]);
      expect((await move(app, "sub/notes", "sub/kept")).status).toBe(200);
      expect((await app.request(fileUrl("sub/kept"), { method: "DELETE" })).status).toBe(200);
      expect(existsSync(join(project, "sub", "page.html"))).toBe(true);
    });

    it("deletes or moves a received folder whose record lists only its own files", async () => {
      const { app, project } = fixture();
      mkdirSync(join(project, "sub"));
      writeFileSync(join(project, "sub", "page.html"), "<div></div>");
      record(project, "sub", ["page.html", "gone.html"]);
      expect((await move(app, "sub", "dist")).status).toBe(200);
      expect(existsSync(join(project, "dist", ".hyperframes", "received-files.json"))).toBe(true);
      expect((await app.request(fileUrl("dist"), { method: "DELETE" })).status).toBe(200);
      expect(existsSync(join(project, "dist"))).toBe(false);
    });

    it("refuses a delete or move whose target is a records folder", async () => {
      const { app, project } = fixture();
      writeFileSync(join(project, "page.html"), "<div></div>");
      record(project, "sub", ["page.html"]);
      expect((await app.request(fileUrl("sub/.hyperframes"), { method: "DELETE" })).status).toBe(
        403,
      );
      expect((await move(app, "sub/.hyperframes", "dist")).status).toBe(403);
    });
  });

  it("refuses the files a package manager runs without a script in package.json", async () => {
    const { app, project } = fixture();
    writeFileSync(join(project, "package.json"), '{"scripts":{"dev":"npx hyperframes preview"}}');
    writeFileSync(join(project, "addon.gyp"), "{}");
    for (const path of ["binding.gyp", "server.js", "server.js::$DATA", "deps/common.gypi "]) {
      for (const method of ["POST", "PUT"]) {
        const response = await app.request(fileUrl(path), { method, body: "content" });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ why: "protected_path" });
      }
    }
    const rename = await app.request(fileUrl("inside.txt"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: "Server.JS." }),
    });
    const duplicate = await app.request("http://localhost/projects/demo/duplicate-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "addon.gyp" }),
    });
    for (const response of [rename, duplicate]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ why: "protected_path" });
    }
    expect(readdirSync(project).sort()).toEqual(["addon.gyp", "inside.txt", "package.json"]);
  });

  it("still writes compositions, stylesheets, script assets and uploads", async () => {
    const { app, project } = fixture();
    for (const path of [
      "index.html",
      "compositions/scene.html",
      "assets/style.css",
      "assets/scene.js",
      "lib/helpers.mjs",
      "assets/data.json",
      "notes.md",
    ]) {
      expect((await put(app, path, { "If-None-Match": "*" })).status).toBe(200);
      expect(readFileSync(join(project, path), "utf8")).toBe("planted");
    }
    expect((await upload(app, "assets")).status).toBe(201);
    expect(readFileSync(join(project, "assets", "upload.txt"), "utf8")).toBe("upload bytes");
    expect((await upload(app, "assets", "take~2.txt")).status).toBe(201);
    expect(readFileSync(join(project, "assets", "take~2.txt"), "utf8")).toBe("upload bytes");
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

  // A hidden name such as `.gitignore` is refused outright (see "git, env and tool files").
  it.each(["archive.tar.txt"])(
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
    writeFileSync(
      join(project, ".hyperframes", "agent-handoff-read.json"),
      '{"sessionId":"secret"}',
    );
    for (const path of [
      ".hyperframes/agent-handoff.json",
      ".hyperframes/app-history.jsonl",
      ".HyperFrames/Agent-Handoff.JSON",
      ".hyperframes/agent-handoff-read.json",
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

  it("include credentials and tool state, which the file routes never serve", async () => {
    const { app, project } = fixture();
    const credentials = [
      ".npmrc",
      ".mcp.json",
      ".claude/x.json",
      ".aws/credentials",
      "id_ed25519",
      "cert.pem",
      ".dev.vars",
      ".vault-token",
      ".cargo/credentials.toml",
      "infra/terraform.tfstate",
    ];
    for (const folder of [".claude", ".aws", ".cargo", "infra"]) mkdirSync(join(project, folder));
    for (const file of credentials) writeFileSync(join(project, file), "secret");
    for (const path of credentials) {
      const res = await app.request(`/projects/p/files/${path}`);
      expect([403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain("secret");
    }
    expect((await app.request("/projects/p/files/inside.txt")).status).toBe(200);
  });

  it("can't be reached by renaming their folder", async () => {
    const { app, project } = fixture();
    mkdirSync(join(project, ".hyperframes"));
    writeFileSync(join(project, ".hyperframes", "app-history.jsonl"), '{"said":"secret"}');
    const rename = await app.request("/projects/p/files/.hyperframes", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: "x" }),
    });
    expect(rename.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(project, "x"))).toBe(false);
  });

  it("are neither read nor rewritten when a rename updates references", async () => {
    const { app, project } = fixture();
    mkdirSync(join(project, ".hyperframes"));
    const share = join(project, ".hyperframes", "share.json");
    writeFileSync(share, '{"ref":"inside.txt"}');
    const response = await app.request("/projects/p/files/inside.txt", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: "moved.txt" }),
    });
    expect(response.status).toBe(200);
    expect(readFileSync(share, "utf8")).toBe('{"ref":"inside.txt"}');
    expect((await response.json()).updatedReferences).toBe(0);
  });

  it("leave Studio's own files under .hyperframes/ reachable", async () => {
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
    // A file uploads accept anywhere else, so the folder is the only reason it is refused.
    form.append("file", new File(["plain words"], "notes.txt"));
    const upload = await app.request("/projects/p/upload?dir=.hyperframes", {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(403);
    expect(existsSync(join(project, ".hyperframes", "notes.txt"))).toBe(false);
    const elsewhere = new FormData();
    elsewhere.append("file", new File(["plain words"], "notes.txt"));
    const fine = await app.request("/projects/p/upload", { method: "POST", body: elsewhere });
    expect((await fine.json()).files).toEqual(["notes.txt"]);
  });
});

describe("git, env and tool files", () => {
  const GIT_CONFIG = "[core]\n\tbare = false\n\turl = https://user:token@example.com/repo\n";
  function gitFixture() {
    const fx = fixture();
    mkdirSync(join(fx.project, ".git", "hooks"), { recursive: true });
    writeFileSync(join(fx.project, ".git", "config"), GIT_CONFIG);
    writeFileSync(join(fx.project, ".env"), "TOKEN=token");
    mkdirSync(join(fx.project, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(fx.project, "node_modules", "pkg", "index.js"), "module.exports = 1;");
    return fx;
  }
  const put = (app: Hono, path: string, headers: Record<string, string> = {}) =>
    app.request(fileUrl(path), { method: "PUT", headers, body: "planted" });
  const json = (body: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it.each([".git/config", ".GIT/config", ".git\\config", ".git./config", "sub/../.git/config"])(
    "never reads or overwrites %s",
    async (path) => {
      const { app, project } = gitFixture();
      const read = await app.request(fileUrl(path));
      expect([403, 404]).toContain(read.status);
      expect(await read.text()).not.toContain("token");
      const write = await put(app, path, { "If-Match": fileContentVersion(GIT_CONFIG) });
      expect([403, 404]).toContain(write.status);
      expect((await app.request(fileUrl(path), { method: "DELETE" })).status).toBe(403);
      expect(readFileSync(join(project, ".git", "config"), "utf8")).toBe(GIT_CONFIG);
    },
  );

  it.each([
    ".git/hooks/post-checkout",
    ".Git/Hooks/pre-commit",
    ".env.local",
    "node_modules/pkg/evil.js",
    "Node_Modules/pkg/evil.js",
    "assets\\node_modules\\pkg\\evil.js",
    ".claude/settings.json",
    ".vscode/settings.json",
    "nested/.git/config",
    "nested/.envrc",
  ])("never creates %s", async (path) => {
    const { app, project } = gitFixture();
    expect((await put(app, path, { "If-None-Match": "*" })).status).toBe(403);
    expect((await app.request(fileUrl(path), { method: "POST", body: "planted" })).status).toBe(
      403,
    );
    const rename = await app.request(fileUrl("inside.txt"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: path }),
    });
    expect(rename.status).toBe(403);
    expect(existsSync(join(project, path))).toBe(false);
    expect(readFileSync(join(project, "inside.txt"), "utf8")).toBe("inside");
  });

  it("refuses to delete or rename the project folder or anything in node_modules or .git", async () => {
    const { app, project } = gitFixture();
    expect((await app.request(fileUrl(""), { method: "DELETE" })).status).toBe(403);
    expect((await app.request(fileUrl("node_modules"), { method: "DELETE" })).status).toBe(403);
    const moveHooks = await app.request(fileUrl(".git/hooks"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPath: "hooks" }),
    });
    expect([403, 404]).toContain(moveHooks.status);
    expect(existsSync(join(project, ".git", "hooks"))).toBe(true);
    expect(existsSync(join(project, "node_modules", "pkg", "index.js"))).toBe(true);
  });

  it("does not copy, upload or patch into protected paths", async () => {
    const { app, project } = gitFixture();
    writeFileSync(join(project, "node_modules", "pkg", "index.html"), "<div id='a'></div>");
    const copy = await app.request(
      "/projects/p/duplicate-file",
      json({ path: "node_modules/pkg/index.js" }),
    );
    expect(copy.status).toBe(403);
    expect(readdirSync(join(project, "node_modules", "pkg")).sort()).toEqual([
      "index.html",
      "index.js",
    ]);
    for (const dir of [".git/hooks", "node_modules/pkg", ".Claude"])
      expect((await upload(app, dir)).status).toBe(403);
    for (const name of [".env", ".gitignore", ".npmrc"])
      expect((await (await upload(app, "", name)).json()).files).toEqual([]);
    expect(readFileSync(join(project, ".env"), "utf8")).toBe("TOKEN=token");
    const rollback = await app.request(
      `/projects/p/gsap-mutation-rollback/${encodeURIComponent("node_modules/pkg/index.html")}`,
      json({ expected: "<div id='a'></div>", restore: "planted" }),
    );
    expect(rollback.status).toBe(403);
    expect(readFileSync(join(project, "node_modules", "pkg", "index.html"), "utf8")).toBe(
      "<div id='a'></div>",
    );
  });

  it("refuses a write through an in-project link into .git or node_modules", async (context) => {
    const { app, project } = gitFixture();
    linkOrSkip(context, join(project, ".git"), join(project, "scenes"), "dir");
    linkOrSkip(context, join(project, "node_modules", "pkg"), join(project, "lib"), "dir");
    expect((await put(app, "scenes/hooks/pre-commit", { "If-None-Match": "*" })).status).toBe(403);
    const viaLink = await put(app, "lib/index.js", {
      "If-Match": fileContentVersion("module.exports = 1;"),
    });
    expect(viaLink.status).toBe(403);
    expect(existsSync(join(project, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(readFileSync(join(project, "node_modules", "pkg", "index.js"), "utf8")).toBe(
      "module.exports = 1;",
    );
  });

  it("checks a long run of spaces, dots or colons in linear time", () => {
    const started = performance.now();
    for (const filler of [" ", ".", ":"]) {
      const long = `a${filler.repeat(200_000)}b`;
      expect(isPrivateProjectPath(long)).toBe(false);
      expect(isWritableProjectPath(`${long}/x.html`)).toBe(true);
      expect(isWritableProjectPath(`.git${filler.repeat(200_000)}/config`)).toBe(false);
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("still reads node_modules and writes Studio's own hidden files", async () => {
    const { app, project } = gitFixture();
    expect((await app.request(fileUrl("node_modules/pkg/index.js"))).status).toBe(200);
    for (const path of [".hyperframes/studio-motion.json", ".media/clip.json"]) {
      expect((await put(app, path, { "If-None-Match": "*" })).status).toBe(200);
      expect(readFileSync(join(project, path), "utf8")).toBe("planted");
    }
  });
});
