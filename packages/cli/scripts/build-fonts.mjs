#!/usr/bin/env node
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const target = "../core/src/fonts/fontData.generated.ts";

if (existsSync(target)) {
  console.log("[build:fonts] skipped — fontData.generated.ts already exists");
  process.exit(0);
}

execSync("cd ../core && tsx scripts/generate-font-data.ts", {
  stdio: "inherit",
});
