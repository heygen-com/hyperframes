import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileContentVersion } from "@hyperframes/studio-server";
import { historyDeps, withOwner } from "../utils/historyOwner.js";
import { receivedFiles } from "../utils/privateProjectFile.js";
import { contentHash } from "../utils/receivedContent.js";
import { outsideAssetsAllowed } from "../utils/receivedRender.js";
import { createStudioServer, type StudioServer } from "./studioServer.js";
import { cleanupStudioServerRoot, makeStudioServerRoot } from "./studioServerTestFixture.js";

const walk = vi.hoisted(() => ({ exhausted: false }));

vi.mock("../utils/walkBudget.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/walkBudget.js")>();
  return { walkBudget: () => (walk.exhausted ? () => false : real.walkBudget()) };
});

let root: string;
let server: StudioServer | undefined;

afterEach(() => {
  walk.exhausted = false;
  if (server) {
    chmodAll(root);
    cleanupStudioServerRoot(server, root);
  }
  server = undefined;
});

function chmodAll(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      chmodSync(join(dir, entry.name), 0o755);
      chmodAll(join(dir, entry.name));
    }
}

function caseInsensitiveDisk(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "hf-case-probe-"));
  try {
    return existsSync(probe.toUpperCase()) && existsSync(probe.toLowerCase());
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

/** Whether a name in composed Unicode reaches a file named in decomposed Unicode, as on macOS and Windows. */
function unicodeFormsFolded(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "hf-unicode-probe-"));
  try {
    writeFileSync(join(probe, "caf\u00e9"), "");
    return existsSync(join(probe, "cafe\u0301"));
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
  server = createStudioServer({
    projectDir: fixture.projectDir,
    projectName: "film",
    historyRoot: join(root, "history"),
  });
  return { projectDir: fixture.projectDir, app: server.app };
}

const fileUrl = (path: string) => `/api/projects/film/files/${encodeURIComponent(path)}`;
const move = (app: StudioServer["app"], from: string, newPath: string) =>
  app.request(fileUrl(from), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newPath }),
  });
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
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

  it("keeps its received pages listed when Studio deletes it, keeping their content", async () => {
    const { projectDir, app } = studio();
    withReceivedFolder(projectDir);
    const scene = contentHash(join(projectDir, "sub", "scene.html"));
    expect((await app.request(fileUrl("sub"), { method: "DELETE" })).status).toBe(200);
    expect(existsSync(join(projectDir, "sub"))).toBe(false);
    const own = join(projectDir, ".hyperframes");
    expect(JSON.parse(readFileSync(join(own, "received-files.json"), "utf-8")).files).toEqual([
      "sub/scene.html",
    ]);
    const content = JSON.parse(readFileSync(join(own, "received-content.json"), "utf-8"));
    expect(content.hashes).toEqual([scene]);
    expect(receivedFiles(projectDir).gone).toBe("sub/scene.html");
    expect(allowed(projectDir)).toBe(false);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps its files listed when a folder delete stops partway",
    async () => {
      const { projectDir, app } = studio();
      withReceivedFolder(projectDir);
      write(join(projectDir, "sub", "locked", "keep.txt"), "x");
      chmodSync(join(projectDir, "sub", "locked"), 0o555);
      const deleted = await app.request(fileUrl("sub"), { method: "DELETE" });
      expect(deleted.ok).toBe(false);
      const listed = JSON.parse(
        readFileSync(join(projectDir, ".hyperframes", "received-files.json"), "utf-8"),
      ).files;
      expect(listed).toContain("sub/scene.html");
      expect(receivedFiles(projectDir)("sub/scene.html")).toBe(true);
    },
  );

  function withOutsideEntry(projectDir: string, entry: string): void {
    withReceivedFolder(projectDir);
    rmSync(join(projectDir, "sub", ".hyperframes"), { recursive: true });
    write(
      join(projectDir, "sub", "notes", ".hyperframes", "received-files.json"),
      JSON.stringify({ files: [entry] }),
    );
  }

  it("keeps a file its record lists outside the folder received after the folder is deleted and the file edited", async () => {
    const { projectDir, app } = studio();
    withOutsideEntry(projectDir, "../scene.html");
    expect((await app.request(fileUrl("sub/notes"), { method: "DELETE" })).status).toBe(200);
    write(join(projectDir, "sub", "scene.html"), `<img src="../../outside/pic.png"><p>edited</p>`);
    expect(receivedFiles(projectDir)("sub/scene.html")).toBe(true);
    expect(allowed(projectDir)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "keeps a listed link out of the project received after its record's folder is deleted",
    async () => {
      const { projectDir, app } = studio();
      withOutsideEntry(projectDir, "../link.png");
      symlinkSync(join(root, "outside", "pic.png"), join(projectDir, "sub", "link.png"));
      expect((await app.request(fileUrl("sub/notes"), { method: "DELETE" })).status).toBe(200);
      expect(receivedFiles(projectDir)("sub/link.png")).toBe(true);
    },
  );

  it("deletes a folder past the project search's size limit, keeping what its record lists outside it", async () => {
    const { projectDir, app } = studio();
    withOutsideEntry(projectDir, "../scene.html");
    walk.exhausted = true;
    expect((await app.request(fileUrl("sub/notes"), { method: "DELETE" })).status).toBe(200);
    walk.exhausted = false;
    write(join(projectDir, "sub", "scene.html"), "<p>edited</p>");
    expect(receivedFiles(projectDir)("sub/scene.html")).toBe(true);
  });

  it("refuses a folder delete when the project's record cannot take the files listed outside it", async () => {
    const { projectDir, app } = studio();
    withOutsideEntry(projectDir, "../scene.html");
    write(join(projectDir, ".hyperframes", "received-files.json.lock"), "");
    expect((await app.request(fileUrl("sub/notes"), { method: "DELETE" })).status).toBe(409);
    expect(existsSync(join(projectDir, "sub", "notes", ".hyperframes"))).toBe(true);
    expect(receivedFiles(projectDir)("sub/scene.html")).toBe(true);
  });
});

describe("a Studio rename, move or delete in a project with a received-files record", () => {
  const record = (folder: string) => join(folder, ".hyperframes", "received-files.json");
  const listed = (folder: string) => JSON.parse(readFileSync(record(folder), "utf-8")).files;
  function withRecord(projectDir: string): void {
    write(join(projectDir, "index.html"), `<div data-composition-src="scenes/intro.html"></div>`);
    write(join(projectDir, "scenes", "intro.html"), `<img src="../../outside/pic.png">`);
    write(join(projectDir, "scenes", "logo.png"), PNG);
    write(record(projectDir), JSON.stringify({ files: ["scenes/intro.html", "scenes/logo.png"] }));
  }

  /** Deletes the received page in Studio, then takes its line out by hand; its content stays kept as received. */
  async function deleteAndForget(app: StudioServer["app"], projectDir: string): Promise<void> {
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    write(record(projectDir), JSON.stringify({ files: ["scenes/logo.png"] }));
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

  it("keeps a deleted received page listed, and takes a deleted received image off the record", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    expect((await app.request(fileUrl("scenes/logo.png"), { method: "DELETE" })).status).toBe(200);
    expect(listed(projectDir)).toEqual(["scenes/intro.html"]);
    expect(receivedFiles(projectDir).gone).toBe("scenes/intro.html");
  });

  it("lets a project whose record lists only media keep reading outside files after Studio deletes one", async () => {
    const { projectDir, app } = studio();
    write(join(projectDir, "index.html"), `<img src="../outside/pic.png">`);
    write(join(projectDir, "logo.png"), PNG);
    write(join(projectDir, "intro.png"), PNG);
    write(record(projectDir), JSON.stringify({ files: ["intro.png", "logo.png"] }));
    expect(allowed(projectDir)).toBe(true);
    expect((await app.request(fileUrl("logo.png"), { method: "DELETE" })).status).toBe(200);
    expect(listed(projectDir)).toEqual(["intro.png"]);
    expect(allowed(projectDir)).toBe(true);
  });

  const create = (app: StudioServer["app"], path: string, body: string) =>
    app.request(fileUrl(path), { method: "POST", body });

  it.each([["scenes/intro.html"], ["scenes/other.html"], ["index2.html"]])(
    "still refuses outside files after every received page is deleted and new bytes are created at %s",
    async (path) => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      for (const file of ["scenes/intro.html", "index.html"])
        expect((await app.request(fileUrl(file), { method: "DELETE" })).status).toBe(200);
      expect((await create(app, path, `<img src="../../outside/pic.png"><!-- 2 -->`)).status).toBe(
        201,
      );
      expect(
        (await create(app, "index.html", `<div data-composition-src="${path}"></div>`)).status,
      ).toBe(201);
      expect(listed(projectDir)).toContain("scenes/intro.html");
      expect(receivedFiles(projectDir)(path)).toBe(true);
      expect(allowed(projectDir)).toBe(false);
    },
  );

  it("still refuses outside files after a received page is renamed to an image name and saved as one", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    write(record(projectDir), JSON.stringify({ files: ["scenes/intro.html"] }));
    expect((await move(app, "scenes/intro.html", "scenes/intro.png")).status).toBe(200);
    expect(listed(projectDir)).toEqual(["scenes/intro.html", "scenes/intro.png"]);
    const before = readFileSync(join(projectDir, "scenes", "intro.png"));
    const saved = await app.request(fileUrl("scenes/intro.png"), {
      method: "PUT",
      headers: { "If-Match": fileContentVersion(before) },
      body: PNG,
    });
    expect(saved.status).toBe(200);
    expect(allowed(projectDir)).toBe(false);
  });

  it("keeps refusing outside files when content comes back after a plain Studio delete, and says the file was gone", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    const intro = join(projectDir, "scenes", "intro.html");
    const before = readFileSync(intro);
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    write(join(projectDir, "index.html"), `<img src="../outside/pic.png">`);
    const warnings: string[] = [];
    expect(outsideAssetsAllowed(projectDir, "index.html", (line) => warnings.push(line))).toBe(
      false,
    );
    expect(warnings.join("\n")).toMatch(/intro\.html came from someone else and is gone/);
    writeFileSync(intro, before);
    expect(listed(projectDir)).toContain("scenes/intro.html");
    expect(receivedFiles(projectDir)("scenes/intro.html")).toBe(true);
    expect(allowed(projectDir)).toBe(false);
  });

  it("drops the old line when a received file with a media name but other bytes is renamed to another media name", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    write(join(projectDir, "scenes", "logo.png"), "not a picture");
    expect((await move(app, "scenes/logo.png", "scenes/logo.webp")).status).toBe(200);
    expect(listed(projectDir)).toEqual(["scenes/intro.html", "scenes/logo.webp"]);
  });

  it("drops the old line when a received image is renamed to another image name", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    expect((await move(app, "scenes/logo.png", "scenes/mark.png")).status).toBe(200);
    expect(listed(projectDir)).toEqual(["scenes/intro.html", "scenes/mark.png"]);
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
    expect(allowed(projectDir)).toBe(false);
  });

  it("never writes over received content it cannot read, and keeps the deleted file listed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { projectDir, app } = studio();
    withRecord(projectDir);
    write(join(projectDir, ".hyperframes", "received-content.json"), "{not json");
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    expect(readFileSync(join(projectDir, ".hyperframes", "received-content.json"), "utf-8")).toBe(
      "{not json",
    );
    expect(listed(projectDir)).toContain("scenes/intro.html");
    warn.mockRestore();
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

  it.runIf(caseInsensitiveDisk())(
    "refuses a rename that changes only the letter case on a disk that folds case, keeping the line",
    async () => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      expect((await move(app, "scenes/intro.html", "scenes/Intro.html")).status).toBe(409);
      expect(listed(projectDir)).toEqual(["scenes/intro.html", "scenes/logo.png"]);
      expect(allowed(projectDir)).toBe(false);
    },
  );

  it.skipIf(caseInsensitiveDisk())(
    "lists a received page under its new name after a rename that changes only its letter case",
    async () => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      expect((await move(app, "scenes/intro.html", "scenes/Intro.html")).status).toBe(200);
      expect(listed(projectDir)).toEqual(["scenes/Intro.html", "scenes/logo.png"]);
      expect(allowed(projectDir)).toBe(false);
    },
  );

  it.skipIf(unicodeFormsFolded())(
    "lists a received page under its new name after a rename from composed to decomposed Unicode",
    async () => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      write(join(projectDir, "scenes", "caf\u00e9.html"), `<img src="../../outside/pic.png">`);
      write(record(projectDir), JSON.stringify({ files: ["scenes/caf\u00e9.html"] }));
      expect((await move(app, "scenes/caf\u00e9.html", "scenes/cafe\u0301.html")).status).toBe(200);
      expect(listed(projectDir)).toEqual(["scenes/cafe\u0301.html"]);
      expect(allowed(projectDir)).toBe(false);
    },
  );

  it.skipIf(unicodeFormsFolded())(
    "keeps a received page listed when a file named like it in another Unicode form is renamed",
    async () => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      write(join(projectDir, "scenes", "caf\u00e9.html"), `<img src="../../outside/pic.png">`);
      write(join(projectDir, "scenes", "cafe\u0301.html"), "<p></p>");
      write(record(projectDir), JSON.stringify({ files: ["scenes/caf\u00e9.html"] }));
      expect((await move(app, "scenes/cafe\u0301.html", "scenes/draft.html")).status).toBe(200);
      expect(listed(projectDir)).toEqual(["scenes/caf\u00e9.html", "scenes/draft.html"]);
    },
  );

  it.skipIf(caseInsensitiveDisk())(
    "lists a received page under its new name when that name differs only in letter case from another listed file",
    async () => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      write(join(projectDir, "scenes", "Opening.html"), "<p>other</p>");
      write(
        record(projectDir),
        JSON.stringify({ files: ["scenes/Opening.html", "scenes/intro.html"] }),
      );
      expect((await move(app, "scenes/intro.html", "scenes/opening.html")).status).toBe(200);
      expect(listed(projectDir)).toEqual(["scenes/Opening.html", "scenes/opening.html"]);
      expect(allowed(projectDir)).toBe(false);
    },
  );

  it.skipIf(caseInsensitiveDisk())(
    "keeps refusing outside files after a received page is renamed in another letter case, deleted and made again",
    async () => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      expect((await move(app, "scenes/intro.html", "scenes/Intro.html")).status).toBe(200);
      const page = fileUrl("scenes/Intro.html");
      expect((await app.request(page, { method: "DELETE" })).status).toBe(200);
      const made = await app.request(page, {
        method: "PUT",
        headers: { "If-None-Match": "*" },
        body: `<img src="../../outside/pic.png"><p>new</p>`,
      });
      expect(made.ok).toBe(true);
      expect(allowed(projectDir)).toBe(false);
    },
  );

  it("answers other requests while it waits for the record's lock, then refuses the rename", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    writeFileSync(`${record(projectDir)}.lock`, "");
    const renaming = move(app, "scenes/intro.html", "scenes/opening.html");
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await app.request(fileUrl("index.html"));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect((await renaming).status).toBe(409);
    expect(existsSync(join(projectDir, "scenes", "intro.html"))).toBe(true);
    expect(existsSync(join(projectDir, "scenes", "opening.html"))).toBe(false);
    expect(listed(projectDir)).toEqual(["scenes/intro.html", "scenes/logo.png"]);
  });

  it("renames a file no record lists while the record is busy", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    writeFileSync(`${record(projectDir)}.lock`, "");
    expect((await move(app, "index.html", "main.html")).status).toBe(200);
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

  it("keeps a received file received through an edit after a delete and an undo", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    expect((await app.request("/api/projects/film/history")).status).toBe(200);
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    expect(listed(projectDir)).toEqual(["scenes/intro.html", "scenes/logo.png"]);
    const restored = await app.request("/api/projects/film/history/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ point: "start" }),
    });
    expect(restored.status).toBe(200);
    expect(existsSync(join(projectDir, "scenes", "intro.html"))).toBe(true);
    write(join(projectDir, "scenes", "intro.html"), `<img src="../../outside/pic.png"><p>2</p>`);
    expect(receivedFiles(projectDir)("scenes/intro.html")).toBe(true);
    expect(allowed(projectDir)).toBe(false);
  });

  it("lists a file holding received content again before a Studio save changes it", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    const intro = join(projectDir, "scenes", "intro.html");
    const before = readFileSync(intro);
    await deleteAndForget(app, projectDir);
    writeFileSync(intro, before);
    const saved = await app.request(fileUrl("scenes/intro.html"), {
      method: "PUT",
      headers: { "If-Match": fileContentVersion(before) },
      body: `<img src="../../outside/pic.png"><p>2</p>`,
    });
    expect(saved.status).toBe(200);
    expect(listed(projectDir)).toContain("scenes/intro.html");
    expect(receivedFiles(projectDir)("scenes/intro.html")).toBe(true);
    const own = readFileSync(join(projectDir, "index.html"));
    const ownSave = await app.request(fileUrl("index.html"), {
      method: "PUT",
      headers: { "If-Match": fileContentVersion(own) },
      body: "<p>mine</p>",
    });
    expect(ownSave.status).toBe(200);
    expect(listed(projectDir)).not.toContain("index.html");
  });

  it.each([
    ["freeze-frame", { path: "scenes/intro.html" }],
    ["split-batch", { files: [{ path: "scenes/intro.html" }] }],
    ["patch-element-batches", { batches: [{ sourceFile: "scenes/intro.html" }] }],
  ])(
    "lists a file holding received content again before a %s edit names it",
    async (operation, body) => {
      const { projectDir, app } = studio();
      withRecord(projectDir);
      const intro = join(projectDir, "scenes", "intro.html");
      const before = readFileSync(intro);
      await deleteAndForget(app, projectDir);
      writeFileSync(intro, before);
      await app.request(`/api/projects/film/file-mutations/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(listed(projectDir)).toContain("scenes/intro.html");
    },
  );

  it("refuses a Studio save to a file holding received content when the record is busy", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    const intro = join(projectDir, "scenes", "intro.html");
    const before = readFileSync(intro);
    await deleteAndForget(app, projectDir);
    writeFileSync(intro, before);
    writeFileSync(`${record(projectDir)}.lock`, "");
    const saved = await app.request(fileUrl("scenes/intro.html"), {
      method: "PUT",
      headers: { "If-Match": fileContentVersion(before) },
      body: "<p>2</p>",
    });
    expect(saved.status).toBe(409);
    expect(readFileSync(intro)).toEqual(before);
  });

  it("keeps a received file received through an edit after a delete and Cmd+Z", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    expect((await app.request("/api/projects/film/history")).status).toBe(200);
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    const post = (path: string, body: object) =>
      app.request(`/api/projects/film/history/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post("checkpoint", {})).status).toBe(200);
    const stepped = await post("step", { direction: "back" });
    expect(await stepped.json()).toMatchObject({ ok: true, entry: { files: expect.any(Array) } });
    expect(existsSync(join(projectDir, "scenes", "intro.html"))).toBe(true);
    write(join(projectDir, "scenes", "intro.html"), "<p>edited</p>");
    expect(receivedFiles(projectDir)("scenes/intro.html")).toBe(true);
  });

  it("keeps a received file received through an edit after a delete and an undo from the CLI with Studio closed", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    expect((await app.request("/api/projects/film/history")).status).toBe(200);
    expect((await app.request(fileUrl("scenes/intro.html"), { method: "DELETE" })).status).toBe(
      200,
    );
    expect(listed(projectDir)).toEqual(["scenes/intro.html", "scenes/logo.png"]);
    await server?.shutdown();
    const saved = { ...historyDeps };
    Object.assign(historyDeps, {
      historyRoot: join(root, "history"),
      findServer: async () => null,
    });
    try {
      const restored = await withOwner(projectDir, (owner) =>
        owner.restore("start", { kind: "agent", name: "Agent" }),
      );
      expect(restored).not.toBeNull();
    } finally {
      Object.assign(historyDeps, saved);
    }
    write(join(projectDir, "scenes", "intro.html"), `<img src="../../outside/pic.png"><p>2</p>`);
    expect(receivedFiles(projectDir)("scenes/intro.html")).toBe(true);
    expect(allowed(projectDir)).toBe(false);
  });

  it("keeps a line whose file is already gone when Studio deletes or renames onto its folder", async () => {
    const { projectDir, app } = studio();
    withRecord(projectDir);
    write(
      record(projectDir),
      JSON.stringify({ files: ["scenes/intro.html", "scenes/old.html", "parts/gone.html"] }),
    );
    expect((await app.request(fileUrl("scenes"), { method: "DELETE" })).status).toBe(200);
    const kept = ["parts/gone.html", "scenes/intro.html", "scenes/old.html"];
    expect(listed(projectDir).sort()).toEqual(kept);
    write(join(projectDir, "draft.html"), "<p></p>");
    expect((await move(app, "draft.html", "parts/gone.html")).status).toBe(200);
    expect(listed(projectDir).sort()).toEqual(kept);
    expect(receivedFiles(projectDir).gone).toBe("scenes/intro.html");
  });

  it("moves a line its record spells in decomposed Unicode, spelled as the move spells it", async () => {
    const { projectDir, app } = studio();
    const folder = "cafe\u0301";
    write(join(projectDir, folder, "intro.html"), "<p></p>");
    write(record(projectDir), JSON.stringify({ files: [`${folder}/intro.html`] }));
    expect((await move(app, folder, `parts/${folder}`)).status).toBe(200);
    expect(listed(projectDir)).toEqual([`parts/${folder}/intro.html`]);
    expect(receivedFiles(projectDir)("parts/caf\u00e9/intro.html")).toBe(true);
  });
});
