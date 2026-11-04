import { writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { testProcessDescendants } from "../utils/processTestUtils.js";

const processFile = process.env.HF_TEST_PROCESS_FILE;
if (!processFile) throw new Error("Missing process file");
const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async (options) => {
  const browser = await launch(options);
  const pid = browser.process()?.pid;
  if (!pid) throw new Error("Browser did not expose its process");
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await newPage();
    writeFileSync(
      processFile,
      JSON.stringify({
        chrome: [pid, ...testProcessDescendants(pid)],
        watchdog: testProcessDescendants(process.pid, /^node/i),
      }),
    );
    return page;
  };
  return browser;
};
await import("../cli.js");
