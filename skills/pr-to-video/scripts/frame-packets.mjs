#!/usr/bin/env node

// Thin wrapper over the shared packet builder in hyperframes-core — this file pins
// this workflow's paths plus its two behavioral differences: a code frame must carry
// an upstream-selected `### Source excerpt`, and code frames get a code-vocabulary
// excerpt appended to their packet. Everything else has one owner:
// ../../hyperframes-core/scripts/lib/frame-packets-core.mjs

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../../hyperframes-core/scripts/lib/frame-packets-core.mjs";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceExcerpt(block) {
  const match = block.match(/^### Source excerpt\s*\n+(```[^\n]*\n[\s\S]*?\n```)/im);
  return match?.[1] ?? null;
}

function validateFrame(frame) {
  const codeFrame = /\bcode-[a-z0-9-]+\b/i.test(core.field(frame.block, "focal") ?? "");
  if (codeFrame && !sourceExcerpt(frame.block)) {
    throw new Error(`${frame.heading}: code frame requires an upstream-selected Source excerpt`);
  }
}

function codeVocabularySection(block) {
  const focal = core.field(block, "focal") ?? "";
  const codeId = focal.match(/\b(code-[a-z0-9-]+)\b/i)?.[1];
  if (!codeId) return "";
  const vocabPath = join(SKILL_DIR, "references", "code-vocabulary.md");
  if (!existsSync(vocabPath)) {
    return `\n## Code block\n\nUse registry block \`${codeId}\`.\n`;
  }
  const vocab = readFileSync(vocabPath, "utf8");
  const lines = vocab.split("\n");
  const exactToken = `\`${codeId.toLowerCase()}\``;
  const matchingLines = lines.filter((line) => line.toLowerCase().includes(exactToken));
  if (matchingLines.length === 0) {
    return `\n## Code block\n\nUse registry block \`${codeId}\`.\n`;
  }
  return `\n## Code block excerpt (${codeId})\n\n${matchingLines.join("\n").trim()}\n`;
}

const CONFIG = {
  animationDir: resolve(SKILL_DIR, "../hyperframes-animation"),
  corePath: resolve(SKILL_DIR, "../hyperframes-core/references/frame-worker-core.md"),
  deltaPath: resolve(SKILL_DIR, "sub-agents/frame-worker.md"),
  validateFrame,
  extraSections: codeVocabularySection,
};

export function buildRolePayload({ outDir }) {
  return core.buildRolePayload({ ...CONFIG, outDir });
}

export function buildFramePackets(options) {
  return core.buildFramePackets({ ...CONFIG, ...options });
}

if (core.isMainModule(import.meta.url)) core.runCli({ buildFramePackets, buildRolePayload });
