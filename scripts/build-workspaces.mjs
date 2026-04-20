import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createBuildBatches, readBuildWorkspaces } from "./build-workspaces-lib.mjs";

const ROOT_DIR = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function runCommand(name) {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", "--filter", name, "build"], {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Build failed for ${name} (code: ${code ?? "null"}, signal: ${signal ?? "none"})`,
        ),
      );
    });
  });
}

async function main() {
  const workspaces = readBuildWorkspaces(ROOT_DIR);
  const batches = createBuildBatches(workspaces);

  for (const [index, batch] of batches.entries()) {
    console.log(`[build-workspaces] batch ${index + 1}/${batches.length}: ${batch.join(", ")}`);
    await Promise.all(batch.map((name) => runCommand(name)));
  }
}

await main();
