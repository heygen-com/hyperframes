#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(fileURLToPath(new URL("../../../", import.meta.url)));
const dist = join(root, "packages/cli/dist/cli.js");
const result = existsSync(dist)
  ? spawnSync(process.execPath, [dist, "media-use", "resolve", ...process.argv.slice(2)], {
      stdio: "inherit",
    })
  : spawnSync(
      "bun",
      [join(root, "packages/cli/src/cli.ts"), "media-use", "resolve", ...process.argv.slice(2)],
      { stdio: "inherit" },
    );
process.exit(result.status ?? 1);
