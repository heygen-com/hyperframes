import { runCommand } from "citty";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import render from "./render.js";
import { consumeCommandResult } from "../../utils/commandResult.js";

const SESSION = "rvs_0f8fad5b-d9cb-469f-a165-70867728950e";

let project: string;
let server: Server;
let baseUrl: string;
let submissions: Record<string, unknown>[];

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), "hf-cloud-reverse-"));
  writeFileSync(
    join(project, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-duration="1"></div></body></html>`,
  );
  submissions = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const path = request.url ?? "";
    response.setHeader("content-type", "application/json");
    const replies: Record<string, unknown> = {
      "/v3/assets/direct-uploads": {
        data: { asset_id: "asst_fixture", upload_url: `${baseUrl}/upload`, upload_headers: {} },
      },
      "/upload": {},
      "/v3/assets/asst_fixture/complete": {
        data: { asset_id: "asst_fixture", url: `${baseUrl}/project.zip` },
      },
      "/v3/hyperframes/renders": { data: { render_id: "hfr_fixture" } },
    };
    if (path === "/v3/hyperframes/renders") {
      submissions.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.statusCode = 202;
    }
    if (!Object.hasOwn(replies, path)) response.statusCode = 404;
    response.end(JSON.stringify(replies[path] ?? {}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  baseUrl = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("HEYGEN_API_KEY", "fixture-key");
  vi.stubEnv("HEYGEN_API_URL", baseUrl);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  rmSync(project, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  consumeCommandResult();
});

const writeConfig = (config: object) =>
  writeFileSync(join(project, "hyperframes.json"), JSON.stringify(config));

describe("cloud render reverse session", () => {
  it("sends the session reverse start saved in the project", async () => {
    writeConfig({ registry: "https://r.test", reverseSessionId: SESSION });
    await runCommand(render, { rawArgs: [project, "--no-wait", "--json"] });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toHaveProperty("reverse_session_id", SESSION);
  });

  it.each([
    ["no hyperframes.json", undefined],
    ["a config without a session", { registry: "https://r.test" }],
    ["a session id that is not an id", { reverseSessionId: "../../etc" }],
    ["a session id the render endpoint would reject", { reverseSessionId: "rvs_legacy" }],
    ["an uppercase session id", { reverseSessionId: SESSION.toUpperCase() }],
  ])("leaves the field out with %s", async (_label, config) => {
    if (config) writeConfig(config);
    await runCommand(render, { rawArgs: [project, "--no-wait", "--json"] });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).not.toHaveProperty("reverse_session_id");
  });

  it("leaves the field out for an uploaded project, whose config is not on disk here", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(project);
    writeConfig({ reverseSessionId: SESSION });
    await runCommand(render, { rawArgs: ["--asset-id", "asst_fixture", "--no-wait", "--json"] });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).not.toHaveProperty("reverse_session_id");
  });
});
