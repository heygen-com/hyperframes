import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const cliDist = resolve(__dirname, "../../cli/dist/cli.js");
const cliSrc = resolve(__dirname, "../../cli/src/cli.ts");
const cliEntry = existsSync(cliDist) ? cliDist : cliSrc;
const fixtureDir = resolve(__dirname, "fixtures/parity-project");

export default defineConfig({
  testDir: ".",
  outputDir: ".debug",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: ".playwright-report" }]],
  use: {
    baseURL: "http://localhost:4200",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--force-color-profile=srgb", "--font-render-hinting=none"] },
      },
    },
  ],
  webServer: {
    command: cliEntry.endsWith(".js")
      ? `node ${cliEntry} preview --port 4200 ${fixtureDir}`
      : `bun ${cliEntry} preview --port 4200 ${fixtureDir}`,
    port: 4200,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
