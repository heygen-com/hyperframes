import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { startTestDnsServer } from "../utils/dnsTestServer.js";
import { testProcessIsAlive } from "../utils/processTestUtils.js";
import { systemLookupInKillableChild } from "./publicNetwork.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "publicNetwork.fixture.ts");

/** What the fixture printed, and how long its process lived after printing it. */
async function resolveInChild(
  mode: "silent" | "answer",
  system: string,
  ipv4?: string,
  env: Record<string, string> = {},
) {
  const server = await startTestDnsServer(mode, ipv4);
  onTestFinished(() => server.close());
  const child = spawn(process.execPath, ["--import", "tsx", fixture], {
    env: { ...process.env, HF_TEST_DNS: server.address, HF_TEST_SYSTEM: system, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  onTestFinished(() => void child.kill("SIGKILL"));
  let printed = "";
  let printedAt = 0;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    printed += chunk;
    if (printedAt) return;
    printedAt = Date.now();
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  });
  await new Promise((resolve) => child.once("exit", resolve));
  return { printed: printed.trim(), livedOnMs: Date.now() - printedAt };
}

it("gives up when neither DNS nor the system lookup answers, and the process is gone right after", async () => {
  const run = await resolveInChild("silent", "stall");
  expect(run.printed).toBe("Capture DNS timed out");
  expect(run.livedOnMs).toBeLessThan(1_000);
}, 30_000);

it("falls back to the system answer when DNS gives none", async () => {
  const run = await resolveInChild("silent", "8.8.4.4");
  expect(run.printed).toBe("8.8.4.4");
  expect(run.livedOnMs).toBeLessThan(1_000);
}, 30_000);

it("uses the DNS answer without asking the system", async () => {
  const run = await resolveInChild("answer", "8.8.4.4", "93.184.216.34");
  expect(run.printed).toBe("93.184.216.34");
  expect(run.livedOnMs).toBeLessThan(1_000);
}, 30_000);

it("takes the hosts file's answer over the DNS one, as the system lookup does", async () => {
  const hosts = "# local override\n8.8.4.4 assets.capture-fixture.com\n";
  const run = await resolveInChild("answer", "stall", "93.184.216.34", { HF_TEST_HOSTS: hosts });
  expect(run.printed).toBe("8.8.4.4");
}, 30_000);

it("refuses a host the hosts file blocks", async () => {
  const hosts = "0.0.0.0 assets.capture-fixture.com\n";
  const run = await resolveInChild("answer", "stall", "93.184.216.34", { HF_TEST_HOSTS: hosts });
  expect(run.printed).toBe("Capture DNS returned a non-public address");
}, 30_000);

it("refuses a host when any of its hosts file addresses is not public", async () => {
  const hosts = "8.8.4.4 assets.capture-fixture.com\n0.0.0.0 assets.capture-fixture.com\n";
  const run = await resolveInChild("answer", "stall", "93.184.216.34", { HF_TEST_HOSTS: hosts });
  expect(run.printed).toBe("Capture DNS returned a non-public address");
}, 30_000);

it("leaves no system lookup running when the CLI exits mid-lookup", async () => {
  const run = await resolveInChild("silent", "stall", undefined, { HF_TEST_EXIT_AFTER_MS: "6000" });
  const pid = Number(/^exit (\d+)$/m.exec(run.printed)?.[1]);
  onTestFinished(() => void (testProcessIsAlive(pid) && process.kill(pid, "SIGKILL")));
  expect(pid).toBeGreaterThan(0);
  expect(testProcessIsAlive(pid)).toBe(false);
}, 30_000);

it("runs the real system lookup in its child", async () => {
  await expect(systemLookupInKillableChild("localhost", 10_000)).resolves.toContain("127.0.0.1");
}, 30_000);
