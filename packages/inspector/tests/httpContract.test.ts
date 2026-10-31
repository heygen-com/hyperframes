import { spawn } from "node:child_process";
import { Agent, request as httpRequest } from "node:http";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createInspectorServer } from "../src/server";

const project = mkdtempSync(join(tmpdir(), "hf-inspector-"));

function start(env?: NodeJS.ProcessEnv) {
  const server = spawn("bun", ["src/server.ts", project, "0"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  const lines = createInterface({ input: server.stdout! });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service startup timeout")), 10000);
    lines.once("line", (line) => {
      clearTimeout(timer);
      resolve(JSON.parse(line).url as string);
    });
  });
  return {
    url: ready,
    stop: async () => {
      server.kill("SIGTERM");
      await new Promise<void>((resolve) => server.once("exit", () => resolve()));
      lines.close();
    },
  };
}

it("answers info with a version, codes every refusal, and does not turn a large body into an empty 200", async () => {
  const server = start();
  try {
    const url = await server.url;
    const info = await (await fetch(url + "/info")).json();
    expect(info.capability).toBe("inspection");
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    const missing = await fetch(url + "/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "not_found",
      code: "not_found",
    });
    // fetch refuses to send a foreign Host, so this one request is raw HTTP.
    const rebound = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = httpRequest(url + "/info", { headers: { host: "evil.example" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          }),
        );
      });
      req.on("error", reject);
      req.end();
    });
    expect(rebound.status).toBe(403);
    expect(rebound.body).toEqual({
      error: "host_not_allowed",
      code: "host_not_allowed",
    });
    const oversized = await fetch(url + "/inspect", {
      method: "POST",
      body: "x".repeat(64_001),
    });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({
      error: "request_too_large",
      code: "request_too_large",
    });
    const agent = new Agent({ keepAlive: true });
    const again = await new Promise<{ status: number }>((resolve, reject) => {
      const first = httpRequest(
        url + "/inspect",
        {
          method: "POST",
          agent,
          headers: { "content-type": "application/json" },
        },
        (res) => {
          res.resume();
          res.on("end", () => {
            const second = httpRequest(url + "/info", { agent }, (next) => {
              next.resume();
              resolve({ status: next.statusCode ?? 0 });
            });
            second.on("error", reject);
            second.end();
          });
        },
      );
      first.on("error", reject);
      first.end("x".repeat(64_001));
    });
    agent.destroy();
    expect(again.status).toBe(200);
    const empty = await fetch(url + "/inspect", {
      method: "POST",
      body: "null",
    });
    expect(empty.status).toBe(500);
    expect(await empty.json()).toEqual({
      error: "internal_error",
      code: "internal_error",
    });
  } finally {
    await server.stop();
  }
});

it("importing the server does not listen", () => {
  expect(typeof createInspectorServer).toBe("function");
});

it("starts when the entry path is a symlink", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-bin-"));
  const link = join(dir, "hyperframes-inspector");
  symlinkSync(fileURLToPath(new URL("../src/server.ts", import.meta.url)), link);
  const child = spawn("bun", [link, project, "0"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout! });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("symlink entry did not listen")), 10000);
      lines.once("line", (line) => {
        clearTimeout(timer);
        resolve(JSON.parse(line).url as string);
      });
      child.once("exit", (code) => reject(new Error(`symlink entry exited ${code}`)));
    });
    expect((await fetch(url + "/info")).status).toBe(200);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    lines.close();
  }
});

it("a project with no browser answers 503 browser_unavailable", async () => {
  const home = mkdtempSync(join(tmpdir(), "hf-home-"));
  writeFileSync(join(project, "index.html"), "<!doctype html><html><body></body></html>");
  for (const env of [
    { ...process.env, HOME: home, HF_INSPECT_CHROME: "" },
    { ...process.env, HF_INSPECT_CHROME: join(home, "missing-chrome") },
  ]) {
    const server = start(env);
    try {
      const url = await server.url;
      const map = await fetch(url + "/element-map", { method: "POST", body: "{}" });
      expect(map.status).toBe(503);
      expect(await map.json()).toEqual({
        error: "browser_unavailable",
        code: "browser_unavailable",
      });
    } finally {
      await server.stop();
    }
  }
});
