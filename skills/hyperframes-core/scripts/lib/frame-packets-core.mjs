// Shared frame-packet builder — the script half of the frame-worker core/delta split.
//
// Each narrative workflow ships a thin `scripts/frame-packets.mjs` wrapper that pins
// its own paths (animation skill, role delta, design-truth resolution, extra packet
// sections) and delegates everything else here, exactly as the markdown half already
// does with `references/frame-worker-core.md` + each workflow's delta. One owner for
// the packet-building logic; the wrappers own only what genuinely differs per workflow.
//
// Packet (<frame_id>.md) = project inputs + the frame's exact `## Frame N` block
// + the blueprint body + every cited rule recipe, inlined — so a worker never opens
// the shared STORYBOARD.md or any skill document. Cited motions are found
// mechanically: the explicit `- rules:` field when present, plus every valid rule id
// (a filename under the animation skill's rules/) mentioned in the block.
//
// _role.md = frame-worker-core.md + the workflow's sub-agents/frame-worker.md,
// concatenated verbatim — the complete worker role, assembled from the two source
// documents so nothing is hand-maintained twice.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function field(block, name) {
  const match = block.match(new RegExp(`^-\\s+${name}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? null;
}

export function splitFrames(storyboard) {
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

export function frameId(frame) {
  const src = field(frame.block, "src");
  if (!src) throw new Error(`${frame.heading}: missing src`);
  return basename(src).replace(/\.html?$/i, "");
}

export function selectedFile(path, heading) {
  if (!path || !existsSync(path)) return "";
  return `\n## ${heading}\n\n${readFileSync(path, "utf8").trim()}\n`;
}

function escapeRegExp(id) {
  return id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function knownRuleIds(animationDir) {
  const rulesDir = join(animationDir, "rules");
  if (!existsSync(rulesDir)) {
    console.warn(
      `frame-packets: no rules dir at ${rulesDir} — packets will inline no motion recipes`,
    );
    return [];
  }
  return readdirSync(rulesDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/, ""));
}

export function citedRules(block, ruleIds) {
  const explicit = (field(block, "rules") ?? "")
    .split(/[,\s]+/)
    .map((rule) => rule.trim())
    .filter(Boolean);
  const mentioned = ruleIds.filter((id) =>
    new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`, "i").test(block),
  );
  return [...new Set([...explicit, ...mentioned])].filter((id) => ruleIds.includes(id));
}

export function resourceSections(block, { animationDir, ruleIds }) {
  let sections = "";
  const blueprint = field(block, "blueprint");
  if (blueprint && blueprint.toLowerCase() !== "compose") {
    sections += selectedFile(
      join(animationDir, "blueprints", `${blueprint}.md`),
      `Selected blueprint: ${blueprint}`,
    );
  }
  for (const rule of citedRules(block, ruleIds)) {
    sections += selectedFile(
      join(animationDir, "rules", `${rule}.md`),
      `Selected motion rule: ${rule}`,
    );
  }
  return sections;
}

export function buildRolePayload({ corePath, deltaPath, outDir }) {
  const core = readFileSync(corePath, "utf8").trim();
  const delta = readFileSync(deltaPath, "utf8").trim();
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
  animationDir,
  corePath,
  deltaPath,
  // Per-workflow hooks (all optional):
  // designTruthLine(projectDir) -> the packet's design-truth input line
  // validateFrame(frame, id)   -> throw to reject a frame before packing
  // extraSections(block)       -> extra packet sections appended after the rule recipes
  designTruthLine = (dir) => `- Design tokens: ${join(resolve(dir), "frame.md")}`,
  validateFrame,
  extraSections,
}) {
  const storyboard = readFileSync(storyboardPath, "utf8");
  const frames = splitFrames(storyboard);
  if (frames.length === 0) throw new Error("STORYBOARD.md has no frame blocks");
  const ruleIds = knownRuleIds(animationDir);

  const packets = frames.map((frame) => {
    const id = frameId(frame);
    if (validateFrame) validateFrame(frame, id);
    const packet = `# Frame packet: ${id}\n\n## Project inputs\n\n- Project: ${resolve(projectDir)}\n${designTruthLine(projectDir)}\n- RULES_DIR: ${join(animationDir, "rules")}\n\n## Assigned storyboard block\n\n${frame.block}\n${resourceSections(frame.block, { animationDir, ruleIds })}${extraSections ? extraSections(frame.block) : ""}`;
    const bytes = Buffer.byteLength(packet);
    if (bytes > maxPacketBytes) {
      throw new Error(`${id}: frame packet is ${bytes} bytes (limit ${maxPacketBytes})`);
    }
    return { frameId: id, path: join(outDir, `${id}.md`), bytes, packet };
  });

  mkdirSync(outDir, { recursive: true });
  for (const { path, packet } of packets) writeFileSync(path, packet);
  buildRolePayload({ corePath, deltaPath, outDir });
  return packets.map(({ packet: _packet, ...result }) => result);
}

export function flag(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

// realpath both sides: on macOS /tmp → /private/tmp, and node resolves the main
// module's symlinks in import.meta.url while argv[1] keeps the invoked spelling —
// a raw compare silently skips main() when invoked through any symlinked path.
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === importMetaUrl;
  } catch {
    return false;
  }
}

export function runCli({ buildFramePackets: build, buildRolePayload: buildRole }) {
  const argv = process.argv.slice(2);
  const projectDir = resolve(flag(argv, "project", "."));
  const outDir = resolve(flag(argv, "out-dir", join(projectDir, ".hyperframes", "frame-packets")));
  try {
    const packets = build({
      projectDir,
      storyboardPath: resolve(flag(argv, "storyboard", join(projectDir, "STORYBOARD.md"))),
      outDir,
    });
    const role = buildRole({ outDir });
    console.log(`✓ frame packets: ${packets.length} bounded packet(s)`);
    for (const packet of packets)
      console.log(`  ${packet.frameId}: ${packet.bytes} bytes → ${packet.path}`);
    console.log(`  worker role: ${role.bytes} bytes → ${role.path}`);
  } catch (error) {
    console.error(`✗ frame packets: ${error.message}`);
    process.exit(1);
  }
}
