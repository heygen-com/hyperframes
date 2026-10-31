import { runCommand } from "citty";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import render from "./render.js";
import { CliRuntimeError, consumeCommandResult } from "../../utils/commandResult.js";

let project: string;
let server: Server;
let baseUrl: string;
let requests: string[];
let submissions: unknown[];

function composition(type: "string" | "number"): string {
  const declarations = JSON.stringify([
    { id: "title", type, label: "Title", default: type === "number" ? 1 : "Intro" },
  ]);
  return `<!doctype html><html data-composition-variables='${declarations}'><body>
    <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="1"></div>
  </body></html>`;
}

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), "hf-cloud-variables-"));
  writeFileSync(join(project, "index.html"), composition("number"));
  mkdirSync(join(project, "compositions"));
  writeFileSync(join(project, "compositions", "intro.html"), composition("string"));
  requests = [];
  submissions = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const path = request.url ?? "";
    requests.push(path);
    response.setHeader("content-type", "application/json");
    const replies: Record<string, unknown> = {
      "/v3/assets/direct-uploads": {
        data: {
          asset_id: "asst_fixture",
          upload_url: `${baseUrl}/upload`,
          upload_headers: {},
        },
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

function submit(variables: Record<string, unknown>, entry?: string) {
  return runCommand(render, {
    rawArgs: [
      project,
      ...(entry ? ["--composition", entry] : []),
      "--variables",
      JSON.stringify(variables),
      "--strict-variables",
      "--no-wait",
      "--json",
    ],
  });
}

describe("cloud render variable validation", () => {
  it("submits values declared by the selected composition instead of index.html", async () => {
    await submit({ title: "Welcome" }, "compositions/intro.html");

    expect(submissions).toEqual([
      expect.objectContaining({
        composition: "compositions/intro.html",
        variables: { title: "Welcome" },
      }),
    ]);
  });

  it("rejects values invalid for the selected composition before uploading", async () => {
    await expect(submit({ title: 42 }, "compositions/intro.html")).rejects.toThrow(CliRuntimeError);

    expect(requests).toEqual([]);
  });

  it("uses index.html when no composition is selected", async () => {
    await submit({ title: 42 });

    expect(submissions).toEqual([expect.objectContaining({ variables: { title: 42 } })]);
  });
});
