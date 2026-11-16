import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeServer, servableProjectFile } from "../src/pageServer";

it("closes while a client holds a connection it never sent a request on, as Chrome's preconnects do", async () => {
  const server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  const preconnect: Socket = await new Promise((done) => {
    const socket = connect(port, "127.0.0.1", () => done(socket));
  });
  // Node's close() leaves a connection with no request yet open: it is not idle, so close() alone waits on it.
  const outcome = await Promise.race([
    closeServer(server).then(() => "closed"),
    new Promise((done) => setTimeout(() => done("still open"), 2000)),
  ]);
  preconnect.destroy();
  expect(outcome).toBe("closed");
});

describe("servableProjectFile", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "hf-inspector-files-")));
  for (const folder of [".git", ".hyperframes", ".claude", "assets"])
    mkdirSync(join(project, folder));
  for (const file of [
    ".env",
    ".env.local",
    ".git/config",
    ".hyperframes/agent-handoff.json",
    ".npmrc",
    ".mcp.json",
    ".claude/settings.local.json",
    "id_ed25519",
  ]) {
    writeFileSync(join(project, file), "SECRET=1");
  }
  writeFileSync(join(project, "assets", "logo.png"), "png");
  writeFileSync(join(project, ".hyperframes", "studio-motion.json"), "{}");
  if (process.platform !== "win32")
    symlinkSync(join(project, ".env"), join(project, "assets", "env.txt"));
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  it.each([
    "/.env",
    "/.ENV",
    "/.env.local",
    "/.env.",
    "/.git/config",
    "/.hyperframes/agent-handoff.json",
    "/.npmrc",
    "/.mcp.json",
    "/.claude/settings.local.json",
    "/id_ed25519",
    "/../outside.txt",
  ])("refuses %s", (path) => {
    expect(servableProjectFile(project, path)).toBeNull();
  });

  it.skipIf(process.platform === "win32")("refuses a link to a private file", () => {
    expect(servableProjectFile(project, "/assets/env.txt")).toBeNull();
  });

  it("serves project assets and Studio's own records", () => {
    expect(servableProjectFile(project, "/assets/logo.png")).toBe(
      join(project, "assets", "logo.png"),
    );
    expect(servableProjectFile(project, "/.hyperframes/studio-motion.json")).toBe(
      join(project, ".hyperframes", "studio-motion.json"),
    );
  });
});
