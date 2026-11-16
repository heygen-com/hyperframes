import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

function write(path: string, text: string): void {
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

  it("refuses a delete or move that would leave a file its record lists behind", async () => {
    const { projectDir, app } = studio();
    withReceivedFolder(projectDir);
    write(
      join(projectDir, "sub", "notes", ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["../scene.html"] }),
    );
    expect((await app.request(fileUrl("sub/notes"), { method: "DELETE" })).status).toBe(403);
    expect((await move(app, "sub/notes", "dist")).status).toBe(403);
    expect((await move(app, "sub/notes", "renders/notes")).status).toBe(403);
    expect(receivedFiles(projectDir)("sub/scene.html")).toBe(true);
    expect(allowed(projectDir)).toBe(false);
  });
});
