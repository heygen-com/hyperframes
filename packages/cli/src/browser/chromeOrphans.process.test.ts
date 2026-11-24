import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import {
  stopTestProcesses,
  testProcessDescendants,
  testProcessIsAlive,
  waitForTestCondition,
} from "../utils/processTestUtils.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "cli.ts");

function project(busy: boolean, seconds = 1): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-chrome-orphans-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  mkdirSync(join(dir, "compositions"));
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="320" data-height="180" data-duration="${seconds}">
<div data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="${seconds}"></div></div>
<script>window.__timelines={main:{duration:()=>${seconds},seek:()=>{},pause:()=>{}}};</script></body></html>`,
  );
  const script = busy
    ? `const el=document.getElementById("box");while(el.offsetWidth<2){el.style.height="1px";}`
    : "";
  writeFileSync(
    join(dir, "compositions/scene.html"),
    `<template id="scene"><div data-composition-id="scene"><div id="box" style="width:1px;height:1px"></div><script>${script}</script></div></template>`,
  );
  return dir;
}

function check(
  dir: string,
  entry = cli,
  env: Record<string, string> = {},
  command = ["check", dir, "--json", "--no-browser-gpu", "--samples=1"],
) {
  const child = spawn(process.execPath, ["--import", "tsx", entry, ...command], {
    env: { ...process.env, CI: "1", HYPERFRAMES_NO_TELEMETRY: "1", ...env },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const seen = { chrome: new Set<number>(), watchdog: new Set<number>() };
  const record = () => {
    for (const pid of testProcessDescendants(child.pid!, /chrom/i)) seen.chrome.add(pid);
    for (const pid of testProcessDescendants(child.pid!, /^node/i)) seen.watchdog.add(pid);
  };
  const done = new Promise<void>((resolve) => child.once("close", () => resolve()));
  onTestFinished(() => stopTestProcesses(child, [...seen.chrome, ...seen.watchdog]));
  return { child, seen, record, done };
}

const alive = (pids: Iterable<number>) => [...pids].filter(testProcessIsAlive);

it("leaves no Chrome process behind when the CLI is killed mid busy-loop", async () => {
  const run = check(project(true));
  await waitForTestCondition(() => {
    run.record();
    return run.seen.chrome.size >= 3;
  }, 30_000);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  run.record();
  run.child.kill("SIGKILL");
  await waitForTestCondition(() => alive(run.seen.chrome).length === 0, 30_000);
  await waitForTestCondition(() => alive(run.seen.watchdog).length === 0, 30_000);
}, 90_000);

it("leaves no Chrome process or watchdog behind after a check that finishes", async () => {
  const dir = project(false);
  const processFile = join(dir, "processes.json");
  const run = check(dir, join(here, "chromeOrphans.fixture.ts"), {
    HF_TEST_PROCESS_FILE: processFile,
  });
  await run.done;
  const seen = JSON.parse(readFileSync(processFile, "utf8")) as {
    chrome: number[];
    watchdog: number[];
  };
  seen.chrome.forEach((pid) => run.seen.chrome.add(pid));
  seen.watchdog.forEach((pid) => run.seen.watchdog.add(pid));
  expect(seen.chrome.length).toBeGreaterThan(0);
  if (process.platform === "win32") expect(seen.watchdog.length).toBeGreaterThan(0);
  await waitForTestCondition(
    () => alive(seen.chrome).length + alive(seen.watchdog).length === 0,
    10_000,
  );
}, 90_000);

it("leaves no Chrome process behind when the CLI is killed mid-render", async () => {
  const dir = project(false, 30);
  const run = check(dir, cli, {}, [
    "render",
    dir,
    "--output",
    join(dir, "out.mp4"),
    "--quality",
    "draft",
  ]);
  await waitForTestCondition(() => {
    run.record();
    return alive(run.seen.chrome).length >= 3;
  }, 60_000);
  run.child.kill("SIGKILL");
  await waitForTestCondition(() => alive(run.seen.chrome).length === 0, 30_000);
}, 120_000);
