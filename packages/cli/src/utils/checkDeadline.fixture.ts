// fallow-ignore-file unused-file
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { testProcessIsAlive, testProcessDescendants } from "./processTestUtils.js";

// Accelerate the hang after the independent authored marker confirms browser startup.
// Production still budgets startup; the unit test verifies that shared deadline.
const realSetTimeout = globalThis.setTimeout;
let armDeadline: (() => void) | undefined;
globalThis.setTimeout = ((
  callback: (...args: unknown[]) => void,
  delay?: number,
  ...args: unknown[]
) => {
  const timer = realSetTimeout(callback, delay, ...args);
  if (delay === 120_000) {
    armDeadline = () => {
      clearTimeout(timer);
      realSetTimeout(callback, 4_000, ...args);
      armDeadline = undefined;
    };
  }
  return timer;
}) as typeof setTimeout;
const pidFile = process.env.HF_TEST_BROWSER_PID_FILE;
if (!pidFile) throw new Error("Missing browser PID file");
// Observe cleanup when the command presents its report, before any exit hook runs.
const log = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const [message] = args;
  if (typeof message === "string" && message.startsWith('{\n  "ok"') && existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8"));
    writeFileSync(`${pidFile}.report-browser-alive`, String(testProcessIsAlive(pid)));
  }
  log(...args);
};
let scriptBrowserPid: number | undefined;
function recordLaunch(file: string, pid: number): void {
  appendFileSync(`${file}.launched`, `${pid}\n`);
  if (scriptBrowserPid === undefined) writeFileSync(file, String(pid));
}
const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async (options) => {
  const browser = await launch(options);
  const browserProcess = browser.process();
  const profile = browserProcess?.spawnargs.find((arg) => arg.startsWith("--user-data-dir="));
  if (!profile) throw new Error("Browser did not expose its profile");
  writeFileSync(`${pidFile}.profile`, profile.slice("--user-data-dir=".length));
  const pid = browserProcess?.pid;
  if (!pid) throw new Error("Browser did not expose its process");
  recordLaunch(pidFile, pid);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await newPage();
    page.on("console", (message) => {
      if (message.text() === "HF_TEST_SCRIPT_START") {
        writeFileSync(`${pidFile}.script`, "started");
        scriptBrowserPid = pid;
        writeFileSync(pidFile, String(pid));
        if (process.platform === "linux") {
          writeFileSync(
            `${pidFile}.tree`,
            JSON.stringify({
              pid,
              alive: testProcessIsAlive(pid),
              descendants: testProcessDescendants(pid),
            }),
          );
        }
        armDeadline?.();
      }
    });
    return page;
  };
  return browser;
};
if (process.env.HF_TEST_DISTINCT_PROFILES === "1") {
  const { ensureBrowser } = await import("../browser/manager.js");
  const { launchManagedBrowser, closeManagedBrowser } = await import("../browser/launch.js");
  const { executablePath } = await ensureBrowser();
  const options = {
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  } as const;
  const first = await launchManagedBrowser(puppeteer, {
    ...options,
    args: [...options.args],
  });
  try {
    const firstProfile = readFileSync(`${pidFile}.profile`, "utf8");
    const firstPid = first.process()?.pid;
    if (!firstPid) throw new Error("First browser has no process");
    writeFileSync(`${pidFile}.first-pid`, String(firstPid));
    const second = await launchManagedBrowser(puppeteer, {
      ...options,
      args: [...options.args],
    });
    try {
      writeFileSync(`${pidFile}.first-alive`, String(testProcessIsAlive(firstPid)));
      writeFileSync(
        `${pidFile}.profiles`,
        JSON.stringify([firstProfile, readFileSync(`${pidFile}.profile`, "utf8")]),
      );
    } finally {
      await closeManagedBrowser(second);
    }
  } finally {
    await closeManagedBrowser(first);
  }
} else {
  await import("../cli.js");
}
