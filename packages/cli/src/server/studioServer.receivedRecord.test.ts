import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { receivedFiles } from "../utils/privateProjectFile.js";
import { outsideAssetsAllowed } from "../utils/receivedRender.js";
import { createStudioServer, type StudioServer } from "./studioServer.js";
import { cleanupStudioServerRoot, makeStudioServerRoot } from "./studioServerTestFixture.js";

let root: string;
let server: StudioServer | undefined;

afterEach(() => {
  if (server) cleanupStudioServerRoot(server, root);
  server = undefined;
});

function caseInsensitiveDisk(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "hf-case-probe-"));
  try {
    return existsSync(probe.toUpperCase()) && existsSync(probe.toLowerCase());
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

function write(path: string, text: string | Buffer): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function studio(): { projectDir: string; app: StudioServer["app"] } {
  const fixture = makeStudioServerRoot("hf-received-record-");
  root = fixture.root;
  write(join(root, "outside", "pic.png"), "x");
  server = createStudioServer({ projectDir: fixture.projectDir, projectName: "film" });
  return { projectDir: fixture.projectDir, app: server.app };
}

const fileUrl = (path: string) => `/api/projects/film/files/${encodeURIComponent(path)}`;
const move = (app: StudioServer["app"], from: string, newPath: string) =>
  app.request(fileUrl(from), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newPath }),
  });
const allowed = (projectDir: string) => outsideAssetsAllowed(projectDir, "index.html", () => {});

describe("a received folder with its own record, in a project with none", () => {
  function withReceivedFolder(projectDir: string): void {
    write(join(projectDir, "index.html"), `<div data-composition-src="sub/scene.html"></div>`);
    write(join(projectDir, "sub", "scene.html"), `<img src="../../outside/pic.png">`);
    write(
      join(projectDir, "sub", ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["scene.html"] }),
    );
  }

  it.each([["dist"], ["renders/sub"], [".hyperframes/requests/sub"]])(
    "keeps its files received when Studio moves it to %s",
    async (to) => {
      const { projectDir, app } = studio();
      withReceivedFolder(projectDir);
      expect(allowed(projectDir)).toBe(false);
      expect((await move(app, "sub", to)).status).toBe(200);
      expect(receivedFiles(projectDir)(`${to}/scene.html`)).toBe(true);
      expect(allowed(projectDir)).toBe(false);
    },
  );

  it("takes its received files along when Studio deletes it", async () => {
    const { projectDir, app } = studio();
    withReceivedFolder(projectDir);
    expect((await app.request(fileUrl("sub"), { method: "DELETE" })).status).toBe(200);
    expect(existsSync(join(projectDir, "sub"))).toBe(false);
  });

  it("keeps a file its record lists outside the folder received after the folder is deleted", async () => {
    const { projectDir, app } = studio();
    withReceivedFolder(projectDir);
    write(
      join(projectDir, "sub", "notes", ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["../scene.html"] }),
    );
    rmSync(join(projectDir, "sub", ".hyperframes"), { recursive: true });
    expect((await app.request(fileUrl("sub/notes"), { method: "DELETE" })).status).toBe(200);
    expect(receivedFiles(projectDir)("sub/scene.html")).toBe(true);
    expect(allowed(projectDir)).toBe(false);
  });
});

describe("a Studio rename, move or delete in a project with a received-files record", () => {
  const record = (folder: string) => join(folder, ".hyperframes", "received-files.json");
  const listed = (folder: string) => JSON.parse(readFileSync(record(folder), "utf-8")).files;
  function withRecord(projectDir: string): void {
    write(join(projectDir, "index.html"), `<div data-composition-src="scenes/intro.html"></div>`);
    write(join(projectDir, "scenes", "intro.html"), `<img src="../../outside/pic.png">`);
    write(join(projectDir, "scenes", "logo.png"), "x");
    write(record(projectDir), JSON.stringify({ files: ["scenes/intro.html", "scenes/logo.png"] }));
  }

  it("keeps a renamed received file received under its new name", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    expect((await move(app, "scenes/intro.html", "scenes/opening.html")).status).toBe(200);
    expect(listed(projectDir)).toEqual(["scenes/logo.png", "scenes/opening.html"]);
    const received = receivedFiles(projectDir);
    expect(received("scenes/opening.html")).toBe(true);
    expect(received("index.html")).toBe(false);
  });

  it("keeps every received file in a moved folder received under the new folder", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    expect((await move(app, "scenes", "parts/scenes")).status).toBe(200);
    expect(listed(projectDir)).toEqual(["parts/scenes/intro.html", "parts/scenes/logo.png"]);
    expect(receivedFiles(projectDir)("parts/scenes/intro.html")).toBe(true);
    expect(receivedFiles(projectDir)("index.html")).toBe(false);
  });

  it("takes a deleted received file off the record, so the person's own files stay theirs", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    const deleted = await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(listed(projectDir)).toEqual(["scenes/logo.png"]);
    expect(receivedFiles(projectDir)("index.html")).toBe(false);
  });

  it("counts a deleted received file as received again when its content comes back", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    const before = readFileSync(join(projectDir, "scenes", "intro.html"));
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    const content = JSON.parse(
      readFileSync(join(projectDir, ".hyperframes", "received-content.json"), "utf-8"),
    );
    expect(content.hashes).toHaveLength(1);
    writeFileSync(join(projectDir, "scenes", "intro.html"), before);
    writeFileSync(join(projectDir, "restored.html"), before);
    const received = receivedFiles(projectDir);
    expect(received("scenes/intro.html")).toBe(true);
    expect(received("restored.html")).toBe(true);
    expect(received("index.html")).toBe(false);
    expect(allowed(projectDir)).toBe(false);
  });

  it("keeps the desktop app's own keys in the received content", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    const desktop = { hashes: [], unlisted: { "a.html": 1 }, copies: { "b.html": [] } };
    write(join(projectDir, ".hyperframes", "received-content.json"), JSON.stringify(desktop));
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    const content = JSON.parse(
      readFileSync(join(projectDir, ".hyperframes", "received-content.json"), "utf-8"),
    );
    expect(content).toMatchObject({ unlisted: desktop.unlisted, copies: desktop.copies });
    expect(content.hashes).toHaveLength(1);
  });

  it.runIf(caseInsensitiveDisk())(
    "follows a rename the request spells in another letter case",
    async () => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      expect((await move(app, "Scenes/INTRO.html", "scenes/opening.html")).status).toBe(200);
      expect(listed(projectDir)).toEqual(["scenes/logo.png", "scenes/opening.html"]);
    },
  );

  it("answers other requests while it waits for the record's lock", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { projectDir, app } = studio();
    withRecord(projectDir);
    writeFileSync(`${record(projectDir)}.lock`, "");
    const renaming = move(app, "scenes/intro.html", "scenes/opening.html");
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await app.request(fileUrl("index.html"));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect((await renaming).status).toBe(200);
    warn.mockRestore();
  });

  it("keeps a file moved out of a received folder received in the project's own record", async () => {
    const { projectDir, app } = studio();
    write(join(projectDir, "sub", "page.html"), "<div></div>");
    write(join(projectDir, "sub", "scene.html"), "<div></div>");
    write(record(join(projectDir, "sub")), JSON.stringify({ files: ["page.html", "scene.html"] }));
    expect((await move(app, "sub/page.html", "page.html")).status).toBe(200);
    expect((await move(app, "sub/scene.html", "sub/opening.html")).status).toBe(200);
    expect(listed(projectDir)).toEqual(["page.html"]);
    expect(listed(join(projectDir, "sub"))).toEqual(["opening.html"]);
    const received = receivedFiles(projectDir);
    expect(received("page.html")).toBe(true);
    expect(received("sub/opening.html")).toBe(true);
  });

  it("leaves the readers answering received when the record cannot be changed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { projectDir, app } = studio();
    withRecord(projectDir);
    writeFileSync(`${record(projectDir)}.lock`, "");
    expect((await move(app, "scenes/intro.html", "scenes/opening.html")).status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("received-files record"));
    expect(receivedFiles(projectDir)("scenes/opening.html")).toBe(true);
    warn.mockRestore();
  });
});
