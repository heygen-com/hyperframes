#!/usr/bin/env node

import { runtimeVersionError } from "../dist/runtimeVersion.js";

const error = runtimeVersionError(process.versions.node);
if (error) {
  console.error(error);
  process.exitCode = 1;
} else {
  const { main } = await import("../dist/fontLocalizeCli.js");
  process.exitCode = await main();
}
