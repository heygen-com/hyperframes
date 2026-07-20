#!/usr/bin/env node

// Thin wrapper over the shared packet builder in hyperframes-core — this file pins
// this workflow's paths plus its one behavioral difference: design truth resolves
// frame.md → design.md → DESIGN.md (general-video § 6 order). Everything else has
// one owner: ../../hyperframes-core/scripts/lib/frame-packets-core.mjs

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../../hyperframes-core/scripts/lib/frame-packets-core.mjs";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function designTruthLine(projectDir) {
  for (const name of ["frame.md", "design.md", "DESIGN.md"]) {
    const candidate = join(resolve(projectDir), name);
    if (existsSync(candidate)) return `- Design truth: ${candidate}`;
  }
  return `- Design truth: ${join(resolve(projectDir), "frame.md")}`;
}

const CONFIG = {
  animationDir: resolve(SKILL_DIR, "../hyperframes-animation"),
  corePath: resolve(SKILL_DIR, "../hyperframes-core/references/frame-worker-core.md"),
  deltaPath: resolve(SKILL_DIR, "sub-agents/frame-worker.md"),
  designTruthLine,
};

export function buildRolePayload({ outDir }) {
  return core.buildRolePayload({ ...CONFIG, outDir });
}

export function buildFramePackets(options) {
  return core.buildFramePackets({ ...CONFIG, ...options });
}

if (core.isMainModule(import.meta.url)) core.runCli({ buildFramePackets, buildRolePayload });
