#!/usr/bin/env node

import module from "node:module";
import { runtimeVersionError } from "../dist/runtimeVersion.js";

// The plugin launcher starts npx outside the project so npm cannot pick the CLI from it,
// and names the project here. Nested CLI runs keep the working folder their caller gives them.
const projectDir = process.env.HYPERFRAMES_PLUGIN_CWD;
delete process.env.HYPERFRAMES_PLUGIN_CWD;
if (projectDir) {
  process.chdir(projectDir);
  // npm's shell resets PWD to the folder npx started in; commands read the project name from it.
  process.env.PWD = projectDir;
}

const error = runtimeVersionError(process.versions.node);
if (error) {
  console.error(error);
  process.exitCode = 1;
} else {
  // Reuses V8 bytecode across runs (os.tmpdir()/node-compile-cache); Node 22.0 has no such API.
  module.enableCompileCache?.();
  if (process.env.HYPERFRAMES_HANG_REPORT) (await import("../dist/hangReport.js")).watchForHang();
  const warm = process.argv[2] === "check" ? await import("../dist/warmCheckClient.js") : undefined;
  if (warm?.warmCheckEligible()) process.once("exit", () => warm.startNextWarmCheck());
  if (!(warm?.warmCheckEligible() && (await warm.runWarmCheck()))) await import("../dist/cli.js");
}
