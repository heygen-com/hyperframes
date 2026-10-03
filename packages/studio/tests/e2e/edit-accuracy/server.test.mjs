import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServer, stopServer } from "./case.mjs";

// Stands in for the CLI when the asked-for port is busy: it binds another port and announces that one.
const FAKE_CLI = `
const server = require("node:http").createServer((req, res) => res.end("[]"));
server.listen(0, "127.0.0.1", () => console.log("Studio: http://localhost:" + server.address().port));
`;

describe("starting the bench's Studio server", () => {
  it("serves on the port the server bound, not the one asked for", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-bench-server-"));
    const cli = join(root, "cli.cjs");
    writeFileSync(cli, FAKE_CLI);
    const asked = 1;
    const { child, port } = await startServer(cli, root, asked, [], root);
    try {
      expect(port).not.toBe(asked);
      expect((await fetch(`http://127.0.0.1:${port}/api/projects`)).ok).toBe(true);
    } finally {
      await stopServer(child);
    }
  });
});
