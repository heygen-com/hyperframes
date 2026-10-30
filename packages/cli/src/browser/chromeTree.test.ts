import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import type { Browser } from "puppeteer-core";
import { waitForTestCondition } from "../utils/processTestUtils.js";
import { closeManagedBrowser } from "./launch.js";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

it.runIf(process.platform !== "win32")(
  "closing a browser also ends the helper processes it leaves behind",
  async () => {
    const main = spawn(
      process.execPath,
      [
        "-e",
        `const h=require("node:child_process").spawn("sleep",["60"],{detached:true,stdio:"ignore"});h.unref();console.log(h.pid);setInterval(()=>{},1e6)`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const helper = Number(
      await new Promise<string>((resolve) => main.stdout!.once("data", (d) => resolve(String(d)))),
    );
    expect(alive(helper)).toBe(true);
    const browser = {
      process: () => main,
      close: async () => {
        main.kill("SIGKILL");
      },
    } as unknown as Browser;
    try {
      await closeManagedBrowser(browser);
      await waitForTestCondition(() => !alive(helper), 5_000);
    } finally {
      if (alive(helper)) process.kill(helper, "SIGKILL");
    }
  },
  30_000,
);
