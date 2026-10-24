#!/usr/bin/env node

import module from "node:module";
import { runtimeVersionError } from "../dist/runtimeVersion.js";

const error = runtimeVersionError(process.versions.node);
if (error) {
  console.error(error);
  process.exitCode = 1;
} else {
  // Reuses V8 bytecode across runs (os.tmpdir()/node-compile-cache); Node 22.0 has no such API.
  module.enableCompileCache?.();
  const warm = process.argv[2] === "check" ? await import("../dist/warmCheckClient.js") : undefined;
  if (warm?.warmCheckEligible()) process.once("exit", () => warm.startNextWarmCheck());
  if (!(warm?.warmCheckEligible() && (await warm.runWarmCheck()))) await import("../dist/cli.js");
}
