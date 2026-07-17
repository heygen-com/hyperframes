#!/usr/bin/env node

// Build the per-frame dispatch packets + the worker role payload.
//
// Packet (<frame_id>.md) = project inputs + the frame's exact `## Frame N` block
// + the blueprint body + every cited rule recipe, inlined — so a worker never
// opens the shared STORYBOARD.md or any skill document. Cited motions are found
// mechanically: the explicit `- rules:` field when present, plus every valid rule
// id (a filename under ../hyperframes-animation/rules/) mentioned in the block.
//
// _role.md = frame-worker-core.md + this skill's sub-agents/frame-worker.md,
// concatenated verbatim — the complete worker role, assembled from the two
// source documents so nothing is hand-maintained twice.

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, "..");
const ANIMATION_DIR = resolve(SKILL_DIR, "../hyperframes-animation");
const CORE_CONTRACT_PATH = resolve(SKILL_DIR, "../hyperframes-core/references/frame-worker-core.md");
const ROLE_DELTA_PATH = resolve(SKILL_DIR, "sub-agents/frame-worker.md");

// Velocity-matched seam recipes (hyperframes-animation/seams, extracted from the
// cut-the-curve doctrine); absent dir degrades to no seam inlining.
const SEAMS_DIR = [join(ANIMATION_DIR, "seams")].find((dir) => existsSync(dir));

function field(block, name) {
  const match = block.match(new RegExp(`^-\\s+${name}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? null;
}

function splitFrames(storyboard) {
  const matches = [...storyboard.matchAll(/^## Frame\s+([^\n]+)$/gm)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? storyboard.length;
    return {
      heading: match[1].trim(),
      block: storyboard.slice(start, end).trim(),
    };
  });
}

function frameId(frame) {
  const src = field(frame.block, "src");
  if (!src) throw new Error(`${frame.heading}: missing src`);
  return basename(src).replace(/\.html?$/i, "");
}

function knownRuleIds() {
  const rulesDir = join(ANIMATION_DIR, "rules");
  if (!existsSync(rulesDir)) return [];
  return readdirSync(rulesDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/, ""));
}

function citedRules(block, ruleIds) {
  const explicit = (field(block, "rules") ?? "")
    .split(/[,\s]+/)
    .map((rule) => rule.trim())
    .filter(Boolean);
  const mentioned = ruleIds.filter((id) =>
    new RegExp(`(?<![\\w-])${id}(?![\\w-])`, "i").test(block),
  );
  return [...new Set([...explicit, ...mentioned])].filter((id) => ruleIds.includes(id));
}

function knownSeamIds() {
  if (!SEAMS_DIR) return [];
  return readdirSync(SEAMS_DIR)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .map((name) => name.replace(/\.md$/, ""));
}

function citedSeams(block, seamIds) {
  const explicit = [field(block, "seam"), field(block, "seams"), field(block, "transition")]
    .filter(Boolean)
    .flatMap((value) => value.split(/[,\s]+/))
    .map((seam) => seam.trim())
    .filter(Boolean);
  const mentioned = seamIds.filter((id) =>
    new RegExp(`(?<![\\w-])${id}(?![\\w-])`, "i").test(block),
  );
  return [...new Set([...explicit, ...mentioned])].filter((id) => seamIds.includes(id));
}

function selectedFile(path, heading) {
  if (!path || !existsSync(path)) return "";
  return `\n## ${heading}\n\n${readFileSync(path, "utf8").trim()}\n`;
}

function resourceSections(block, ruleIds) {
  let sections = "";
  const blueprint = field(block, "blueprint");
  if (blueprint && blueprint.toLowerCase() !== "compose") {
    sections += selectedFile(
      join(ANIMATION_DIR, "blueprints", `${blueprint}.md`),
      `Selected blueprint: ${blueprint}`,
    );
  }
  for (const rule of citedRules(block, ruleIds)) {
    sections += selectedFile(
      join(ANIMATION_DIR, "rules", `${rule}.md`),
      `Selected motion rule: ${rule}`,
    );
  }
  const seams = citedSeams(block, knownSeamIds());
  if (seams.length > 0 && SEAMS_DIR) {
    sections += selectedFile(join(SEAMS_DIR, "_seam-law.md"), "Seam law");
    for (const seam of seams) {
      sections += selectedFile(join(SEAMS_DIR, `${seam}.md`), `Selected seam: ${seam}`);
    }
  }
  return sections;
}

export function buildRolePayload({ outDir }) {
  const core = readFileSync(CORE_CONTRACT_PATH, "utf8").trim();
  const delta = readFileSync(ROLE_DELTA_PATH, "utf8").trim();
  const role = `${core}\n\n---\n\n${delta}\n`;
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "_role.md");
  writeFileSync(path, role);
  return { path, bytes: Buffer.byteLength(role) };
}

export function buildFramePackets({
  projectDir,
  storyboardPath = join(projectDir, "STORYBOARD.md"),
  outDir = join(projectDir, ".hyperframes", "frame-packets"),
  maxPacketBytes = 48_000,
}) {
  const storyboard = readFileSync(storyboardPath, "utf8");
  const frames = splitFrames(storyboard);
  if (frames.length === 0) throw new Error("STORYBOARD.md has no frame blocks");
  const ruleIds = knownRuleIds();

  const packets = frames.map((frame) => {
    const id = frameId(frame);
    const packet = `# Frame packet: ${id}\n\n## Project inputs\n\n- Project: ${resolve(projectDir)}\n- Design tokens: ${join(resolve(projectDir), "frame.md")}\n- RULES_DIR: ${join(ANIMATION_DIR, "rules")}\n\n## Assigned storyboard block\n\n${frame.block}\n${resourceSections(frame.block, ruleIds)}`;
    const bytes = Buffer.byteLength(packet);
    if (bytes > maxPacketBytes) {
      throw new Error(`${id}: frame packet is ${bytes} bytes (limit ${maxPacketBytes})`);
    }
    return { frameId: id, path: join(outDir, `${id}.md`), bytes, packet };
  });

  mkdirSync(outDir, { recursive: true });
  for (const { path, packet } of packets) writeFileSync(path, packet);
  buildRolePayload({ outDir });
  return packets.map(({ packet: _packet, ...result }) => result);
}

function flag(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function main() {
  const argv = process.argv.slice(2);
  const projectDir = resolve(flag(argv, "project", "."));
  const outDir = resolve(
    flag(argv, "out-dir", join(projectDir, ".hyperframes", "frame-packets")),
  );
  try {
    const packets = buildFramePackets({
      projectDir,
      storyboardPath: resolve(flag(argv, "storyboard", join(projectDir, "STORYBOARD.md"))),
      outDir,
    });
    const role = buildRolePayload({ outDir });
    console.log(`✓ frame packets: ${packets.length} bounded packet(s)`);
    for (const packet of packets)
      console.log(`  ${packet.frameId}: ${packet.bytes} bytes → ${packet.path}`);
    console.log(`  worker role: ${role.bytes} bytes → ${role.path}`);
  } catch (error) {
    console.error(`✗ frame packets: ${error.message}`);
    process.exit(1);
  }
}

// realpath both sides: on macOS /tmp → /private/tmp, and node resolves the main
// module's symlinks in import.meta.url while argv[1] keeps the invoked spelling —
// a raw compare silently skips main() when invoked through any symlinked path.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) main();
