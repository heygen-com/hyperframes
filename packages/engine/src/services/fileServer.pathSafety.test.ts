import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createFileServer, type FileServerHandle } from "./fileServer.js";

/**
 * The server derives each request path from the URL and joins it onto
 * compiledDir/projectDir. Hono decodes percent escapes when routing, so an
 * encoded separator or dot segment in the request must never walk out of the
 * served roots — Chrome never requests those shapes, but anything that can
 * reach the port (LAN bind, other local processes) can. On Windows an encoded
 * backslash (%5c) decodes to a real separator, so `..%5c..%5c` escapes even
 * though `..%2f` is normalized away by join(). These tests pin containment
 * at the handler.
 */
describe("fileServer path containment", () => {
  let root: string;
  let projectDir: string;
  let outsideFile: string;
  let server: FileServerHandle;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(tmpdir(), "hf-fileserver-containment-"));
    projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, "index.html"), "<html></html>");
    outsideFile = path.join(root, "outside-secret.txt");
    fs.writeFileSync(outsideFile, "OUTSIDE");
    server = await createFileServer({
      headScripts: [],
      bodyScripts: [],
      projectDir,
    });
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const escapeAttempts = [
    // Encoded separators: %2f collapses with a leading dot-segment only via a
    // nested hop, %5c is a live separator on Windows.
    "/..%2foutside-secret.txt",
    "/%2e%2e%2foutside-secret.txt",
    "/nested%2f..%2f..%2foutside-secret.txt",
    "/..%5coutside-secret.txt",
    "/..%5c..%5coutside-secret.txt",
  ];

  it.each(escapeAttempts)("rejects encoded traversal %s", async (requestPath) => {
    const response = await fetch(`${server.url}${requestPath}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("OUTSIDE");
  });

  it("still serves files inside the project", async () => {
    const response = await fetch(`${server.url}/index.html`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<html>");
  });
});

describe("fileServer private project files", () => {
  it.each(["/.env", "/.Env.local", "/.git/config", "/%2egit/config"])(
    "answers %s with 404",
    async (requestPath) => {
      const projectDir = fs.mkdtempSync(path.join(tmpdir(), "hf-fileserver-private-"));
      fs.mkdirSync(path.join(projectDir, ".git"));
      fs.writeFileSync(path.join(projectDir, ".env"), "SECRET=1");
      fs.writeFileSync(path.join(projectDir, ".Env.local"), "SECRET=1");
      fs.writeFileSync(path.join(projectDir, ".git", "config"), "SECRET=1");
      fs.writeFileSync(path.join(projectDir, "asset.txt"), "ok");
      const server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
      try {
        const response = await fetch(`${server.url}${requestPath}`);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain("SECRET");
        expect((await fetch(`${server.url}/asset.txt`)).status).toBe(200);
      } finally {
        server.close();
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    },
  );
});

describe("fileServer tool records", () => {
  it.each([
    ".hyperframes/app-history.jsonl",
    ".hyperframes/agent-handoff.json",
    ".hyperframes/comments.jsonl",
    "%2ehyperframes/agent-handoff.json",
    ".hyperframes%2fcomments.jsonl",
    "linked-history.json",
  ])(
    "answers %s with 404 from either root and still serves prepared assets",
    async (requestPath) => {
      const projectDir = fs.mkdtempSync(path.join(tmpdir(), "hf-fileserver-records-"));
      const compiledDir = fs.mkdtempSync(path.join(tmpdir(), "hf-fileserver-records-compiled-"));
      for (const root of [projectDir, compiledDir]) {
        fs.mkdirSync(path.join(root, ".hyperframes", "prepared-assets"), { recursive: true });
        for (const name of ["app-history.jsonl", "agent-handoff.json", "comments.jsonl"]) {
          fs.writeFileSync(path.join(root, ".hyperframes", name), "PRIVATE_RECORD");
        }
      }
      fs.writeFileSync(
        path.join(projectDir, ".hyperframes", "prepared-assets", "clip.txt"),
        "prepared",
      );
      fs.symlinkSync(
        path.join(projectDir, ".hyperframes", "app-history.jsonl"),
        path.join(projectDir, "linked-history.json"),
      );
      const server = await createFileServer({
        headScripts: [],
        bodyScripts: [],
        projectDir,
        compiledDir,
      });
      try {
        const response = await fetch(`${server.url}/${requestPath}`);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain("PRIVATE_RECORD");
        const prepared = await fetch(`${server.url}/.hyperframes/prepared-assets/clip.txt`);
        expect(await prepared.text()).toBe("prepared");
      } finally {
        server.close();
        fs.rmSync(projectDir, { recursive: true, force: true });
        fs.rmSync(compiledDir, { recursive: true, force: true });
      }
    },
  );
});
