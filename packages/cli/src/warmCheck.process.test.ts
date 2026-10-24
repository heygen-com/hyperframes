import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import {
  stopTestProcesses,
  testProcessDescendants,
  testProcessIsAlive,
  waitForTestCondition,
} from "./utils/processTestUtils.js";
import { Frame, encodeFrame, frameReader, warmCheckEndpoint } from "./warmCheckProtocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const CHECK_ARGS = ["--json", "--no-browser-gpu", "--samples=1"];
const CHROME = /chrom/i;

function temporary(prefix: string, base = tmpdir()): string {
  const dir = mkdtempSync(join(base, prefix));
  onTestFinished(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function privateEnv(): Record<string, string> {
  const base = temporary("hfw-", process.platform === "win32" ? tmpdir() : "/tmp");
  return {
    ...(process.env as Record<string, string>),
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    ...(process.platform === "win32" ? { LOCALAPPDATA: base } : { XDG_RUNTIME_DIR: base }),
  };
}

function project(hang = false): string {
  const dir = temporary("hf-warm-check-");
  mkdirSync(join(dir, "compositions"));
  const scene = hang
    ? `<div data-composition-id="hang" data-composition-src="compositions/hang.html" data-start="0" data-duration="1"></div>`
    : `<p style="color:#fff;background:#000">Warm</p>`;
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-duration="1">${scene}</div>
<script>window.__timelines.main={duration:()=>1,seek:()=>{},pause:()=>{}};</script></body></html>`,
  );
  writeFileSync(
    join(dir, "compositions/hang.html"),
    `<template id="hang"><div data-composition-id="hang"><div id="box" style="width:1px;height:1px"></div>
<script>const el=document.getElementById("box");while(el.offsetWidth<2){el.style.height="1px";}</script>
</div></template>`,
  );
  return dir;
}

function run(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
  const done = new Promise<number | null>((resolve) => child.once("close", resolve));
  onTestFinished(() => stopTestProcesses(child, []));
  return { child, done, stdout: () => stdout, stderr: () => stderr };
}

async function warmProcess(dir: string, env: Record<string, string>, idleMs = 60_000) {
  const warm = run([join(here, "warmCheck.ts"), String(idleMs), dir, ...CHECK_ARGS], env);
  const pid = warm.child.pid!;
  let chrome: number[] = [];
  onTestFinished(() => stopTestProcesses(warm.child, testProcessDescendants(pid)));
  await waitForTestCondition(() => {
    chrome = testProcessDescendants(pid, CHROME);
    return chrome.length > 0;
  }, 30_000);
  const serving = () =>
    existsSync(join(dir, ".hyperframes")) && readdirSync(join(dir, ".hyperframes")).length > 0;
  return { ...warm, pid, chrome: () => chrome, serving };
}

function client(dir: string, env: Record<string, string>) {
  return run([join(here, "warmCheckClient.fixture.ts"), "check", dir, ...CHECK_ARGS], env);
}

function gone(pids: number[]): boolean {
  return pids.every((pid) => !testProcessIsAlive(pid));
}

function findings(json: string) {
  const report = JSON.parse(json.slice(json.indexOf("{"))) as { saved?: unknown };
  delete report.saved;
  return report;
}

function forgedRequest(env: Record<string, string>, dir: string): Promise<Frame[]> {
  return new Promise((resolve, reject) => {
    const seen: Frame[] = [];
    const socket = connect(warmCheckEndpoint(env)!.address, () => {
      socket.write(encodeFrame(Frame.Hello, "nonce"));
      const request = { argv: ["check", dir], script: "x", cwd: dir, envDigest: "x", proof: "x" };
      socket.write(encodeFrame(Frame.Request, JSON.stringify(request)));
    });
    socket.on(
      "data",
      frameReader((type) => seen.push(type)),
    );
    socket.on("error", reject);
    socket.on("close", () => resolve(seen));
  });
}

function impostor(address: string, reply?: Buffer) {
  const frames: Frame[] = [];
  const server = createServer((socket) => {
    socket.on(
      "data",
      frameReader((type) => {
        frames.push(type);
        if (reply) socket.write(reply);
      }),
    );
    socket.on("error", () => {});
  });
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return new Promise<{ frames: Frame[] }>((resolve) =>
    server.listen(address, () => resolve({ frames })),
  );
}

it("serves a check that prints what a cold check prints, then exits with its Chrome", async () => {
  const env = privateEnv();
  const dir = project();
  const warm = await warmProcess(dir, env);
  const chrome = warm.chrome();
  const served = client(dir, env);
  expect(await served.done).toBe(0);
  await waitForTestCondition(() => !testProcessIsAlive(warm.pid) && gone(chrome), 10_000);

  const cold = run([join(here, "cli.ts"), "check", dir, ...CHECK_ARGS], env);
  expect(await cold.done, `${cold.stdout()}\n${cold.stderr()}`).toBe(0);
  expect(findings(served.stdout())).toEqual(findings(cold.stdout()));
}, 120_000);

it("keeps waiting after a connection that sends no request, then serves", async () => {
  const env = privateEnv();
  const dir = project();
  const warm = await warmProcess(dir, env);
  await new Promise<void>((resolve) => {
    const probe = connect(warmCheckEndpoint(env)!.address, () => probe.destroy());
    probe.once("close", () => resolve());
  });
  const served = client(dir, env);
  expect(await served.done).toBe(0);
  expect(served.stdout()).not.toContain("NOT SERVED");
  await waitForTestCondition(() => !testProcessIsAlive(warm.pid), 10_000);
}, 120_000);

it("takes its Chrome with it when the warm process is killed", async () => {
  const warm = await warmProcess(project(), privateEnv());
  const chrome = warm.chrome();
  warm.child.kill("SIGKILL");
  await waitForTestCondition(() => gone(chrome), 10_000);
}, 60_000);

it("stops with its Chrome when the client is killed mid-check", async () => {
  const env = privateEnv();
  const dir = project(true);
  const warm = await warmProcess(dir, env);
  const chrome = warm.chrome();
  const served = client(dir, env);
  await waitForTestCondition(warm.serving, 30_000);
  served.child.kill("SIGKILL");
  await waitForTestCondition(() => !testProcessIsAlive(warm.pid) && gone(chrome), 10_000);
}, 60_000);

it("exits with its Chrome after its idle window", async () => {
  const warm = await warmProcess(project(), privateEnv(), 10_000);
  const chrome = warm.chrome();
  await waitForTestCondition(() => !testProcessIsAlive(warm.pid) && gone(chrome), 30_000);
}, 60_000);

it("declines a client whose environment differs, and exits for the new one", async () => {
  const env = privateEnv();
  const dir = project();
  const warm = await warmProcess(dir, env);
  const declined = client(dir, { ...env, HF_WARM_TEST_EXTRA: "1" });
  expect(await declined.done).toBe(0);
  expect(declined.stdout()).toBe("NOT SERVED\n");
  await waitForTestCondition(() => !testProcessIsAlive(warm.pid), 10_000);
}, 60_000);

it("leaves a second client to run cold while it serves the first", async () => {
  const env = privateEnv();
  const dir = project(true);
  const warm = await warmProcess(dir, env);
  client(dir, env);
  await waitForTestCondition(warm.serving, 30_000);
  expect(await forgedRequest(env, dir)).toEqual([Frame.Proof, Frame.Declined]);
  const second = client(dir, env);
  expect(await second.done).toBe(0);
  expect(second.stdout()).toBe("NOT SERVED\n");
}, 60_000);

it("declines a request whose proof is wrong, then still serves a genuine client", async () => {
  const env = privateEnv();
  const dir = project();
  const warm = await warmProcess(dir, env);
  expect(await forgedRequest(env, dir)).toEqual([Frame.Proof, Frame.Declined]);
  expect(testProcessIsAlive(warm.pid)).toBe(true);
  const served = client(dir, env);
  expect(await served.done).toBe(0);
  expect(served.stdout()).not.toContain("NOT SERVED");
}, 120_000);

it("sends an impostor that cannot prove the token nothing but its nonce, and runs cold", async () => {
  const env = privateEnv();
  const forged = encodeFrame(Frame.Proof, JSON.stringify({ proof: "0".repeat(64), nonce: "n" }));
  const seen = await impostor(warmCheckEndpoint(env)!.address, forged);
  const cold = client(project(), env);
  expect(await cold.done).toBe(0);
  expect(cold.stdout()).toContain("NOT SERVED");
  expect(seen.frames).toEqual([Frame.Hello]);
}, 120_000);

it("gives up on a silent impostor and runs cold, having sent only its nonce", async () => {
  const env = privateEnv();
  const seen = await impostor(warmCheckEndpoint(env)!.address);
  const cold = client(project(), env);
  expect(await cold.done).toBe(0);
  expect(cold.stdout()).toContain("NOT SERVED");
  expect(seen.frames).toEqual([Frame.Hello]);
}, 120_000);
