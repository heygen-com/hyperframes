#!/usr/bin/env tsx
/**
 * Quick smoke test for the turbo renderer.
 */

import { turboRender } from "./turbo-renderer.js";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function main() {
  const workDir = join(tmpdir(), `renderer-check-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });

  console.log("Running turbo renderer smoke test...");
  console.log("Note: Requires a running file server with a HyperFrames composition.\n");

  const url = process.argv[2];
  if (!url) {
    console.log("Usage: check-renderer.ts <composition-url>");
    console.log("Example: check-renderer.ts http://localhost:3000/index.html");
    process.exit(1);
  }

  const result = await turboRender({
    url,
    width: 540,
    height: 960,
    fps: 30,
    duration: 2, // Just 2 seconds for a quick check
    outputPath: join(workDir, "check.mp4"),
    verbose: true,
  });

  if (result.success) {
    console.log(`\nSUCCESS: ${result.totalMs}ms, ${result.avgCaptureMs.toFixed(1)}ms/frame`);
    console.log(`Output: ${join(workDir, "check.mp4")} (${(result.outputSize / 1024).toFixed(0)}KB)`);
  } else {
    console.error(`\nFAILED: ${result.error}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
