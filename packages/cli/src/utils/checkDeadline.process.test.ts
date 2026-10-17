import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import Ajv from "ajv/dist/jtd.js";
import type { JTDDataType } from "ajv/dist/jtd.js";
import { terminateProcessTree } from "./processTree.js";
import { stopTestProcesses, testProcessIsAlive } from "./processTestUtils.js";

const reportSchema = {
  properties: {
    ok: { type: "boolean" },
    runtime: {
      properties: { findings: { elements: {} } },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;
const treeSchema = {
  properties: {
    pid: { type: "uint32" },
    alive: { type: "boolean" },
    descendants: { elements: { type: "uint32" } },
  },
} as const;
const profilesSchema = { elements: { type: "string" } } as const;
const parser = new Ajv();
const parseProfiles = parser.compileParser<JTDDataType<typeof profilesSchema>>(profilesSchema);
const parseReport = parser.compileParser<JTDDataType<typeof reportSchema>>(reportSchema);
const parseTree = parser.compileParser<JTDDataType<typeof treeSchema>>(treeSchema);

function readPid(path: string): number {
  const pid = Number(readFileSync(path, "utf8"));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid browser PID");
  return pid;
}

function readTree(path: string): JTDDataType<typeof treeSchema> {
  const tree = parseTree(readFileSync(path, "utf8"));
  if (!tree || tree.pid === 0 || tree.descendants.includes(0)) {
    throw new Error("Invalid process-tree snapshot");
  }
  return tree;
}

function writeHangProject(dir: string): void {
  mkdirSync(join(dir, "compositions"));
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-duration="1">
<div data-composition-id="hang" data-composition-src="compositions/hang.html" data-start="0" data-duration="1"></div>
</div><script>window.__timelines.main={duration:()=>1,seek:()=>{},pause:()=>{}};</script></body></html>`,
  );
  writeFileSync(
    join(dir, "compositions/hang.html"),
    `<template id="hang">
<div data-composition-id="hang"><div id="box" style="width:1px;height:1px"></div>
<script>console.debug("HF_TEST_SCRIPT_START");const el=document.getElementById("box");while(el.offsetWidth<2){el.style.height="1px";}</script>
</div></template>`,
  );
}

it(
  "check returns file-specific JSON, exit 1, and a stopped browser",
  () => runWitness(false),
  60_000,
);
// This extra witness reads Linux /proc and its zombie states, unavailable on Windows and macOS.
it.skipIf(process.platform !== "linux")(
  "Linux /proc records live descendants that check stops",
  () => runWitness(true),
  60_000,
);

it(
  "managed launches own distinct profiles while the first browser is alive",
  () => runWitness(false, true),
  60_000,
);

async function runWitness(inspectLinuxTree: boolean, inspectProfiles = false): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "hf-check-deadline-"));
  const pidFile = join(dir, "browser.pid");
  writeHangProject(dir);
  const fixture = join(dirname(fileURLToPath(import.meta.url)), "checkDeadline.fixture.ts");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fixture,
      "check",
      "--json",
      "--no-browser-gpu",
      "--timeout=500",
      "--samples=1",
      dir,
    ],
    {
      env: {
        ...process.env,
        HF_TEST_BROWSER_PID_FILE: pidFile,
        HF_TEST_DISTINCT_PROFILES: inspectProfiles ? "1" : "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let stdout = "";
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
    stdout += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    output += data.toString();
  });
  const done = new Promise<number | null>((resolve) => child.once("close", resolve));
  onTestFinished(async () => {
    const exited = () => child.exitCode !== null || child.signalCode !== null;
    let terminationFailure: unknown;
    try {
      if (child.pid && !exited()) {
        await terminateProcessTree(child.pid, {
          child,
          spawnProcess: (command, args, options) =>
            spawn(command, args, { ...options, timeout: 5_000 }),
        });
      }
    } catch (error) {
      if (!exited()) terminationFailure = error;
    } finally {
      const pids = [pidFile, `${pidFile}.first-pid`].filter(existsSync).map(readPid);
      const descendants = existsSync(`${pidFile}.tree`)
        ? readTree(`${pidFile}.tree`).descendants
        : [];
      await stopTestProcesses(child, [...descendants, ...pids]);
    }
    if (terminationFailure !== undefined) throw terminationFailure;
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  expect(await done, output).toBe(inspectProfiles ? 0 : 1);
  if (inspectProfiles) {
    expect(readFileSync(`${pidFile}.first-alive`, "utf8")).toBe("true");
    const profiles = parseProfiles(readFileSync(`${pidFile}.profiles`, "utf8"));
    expect(profiles).toHaveLength(2);
    expect(new Set(profiles).size).toBe(2);
    expect(testProcessIsAlive(readPid(`${pidFile}.first-pid`))).toBe(false);
    expect(testProcessIsAlive(readPid(pidFile))).toBe(false);
    return;
  }
  const report = parseReport(stdout.slice(stdout.indexOf('{\n  "ok"')));
  if (!report) throw new Error(`Invalid check JSON: ${output}`);
  expect(report.ok).toBe(false);
  expect(report.runtime.findings).toContainEqual(
    expect.objectContaining({
      severity: "error",
      sourceFile: "compositions/hang.html",
      message: expect.stringContaining("script did not finish"),
    }),
  );
  const browserPid = readPid(pidFile);
  expect(testProcessIsAlive(browserPid)).toBe(false);
  expect(readFileSync(`${pidFile}.profile`, "utf8")).not.toBe(join(dir, "profile"));
  expect(readFileSync(`${pidFile}.report-browser-alive`, "utf8")).toBe("false");
  expect(readFileSync(`${pidFile}.script`, "utf8")).toBe("started");
  if (inspectLinuxTree) {
    const snapshot = readTree(`${pidFile}.tree`);
    expect(snapshot.pid).toBe(browserPid);
    expect(snapshot.alive).toBe(true);
    expect(snapshot.descendants.length).toBeGreaterThan(0);
    expect(snapshot.descendants.every((pid) => !testProcessIsAlive(pid))).toBe(true);
  }
}
