import type { LintContext, HyperframeLintFinding } from "../context";
import { readAttr, readDecodedAttr, truncateSnippet } from "../utils";

export type AudioAttribute = "data-automation" | "data-fx-chain";

// The renderer parses these in @hyperframes/core, which depends on this package, so the envelope is restated
// here; core's audioAttributeLintParity test fails if the two drift apart.
const AUDIO_ATTRIBUTES: Record<AudioAttribute, { list: string; noun: string; item: string }> = {
  "data-automation": { list: "lanes", noun: "automation", item: "Lane" },
  "data-fx-chain": { list: "nodes", noun: "chain", item: "Node" },
};
const AUDIO_ATTRIBUTE_VERSION = 1;

/**
 * Why the renderer would refuse an audio attribute's value before reading any lane or effect, or null when the
 * envelope reads. Lane targets and effect types are left to the render: they need core's effect registry.
 */
export function audioAttributeShapeError(attr: AudioAttribute, json: string): string | null {
  const { list, noun, item } = AUDIO_ATTRIBUTES[attr];
  const parsed = parseEnvelope(json);
  if (typeof parsed === "string") return parsed;
  if (parsed.version !== AUDIO_ATTRIBUTE_VERSION) {
    return `unsupported ${noun} version: ${String(parsed.version)}`;
  }
  const entries = parsed[list];
  if (!Array.isArray(entries)) return `it is missing a \`${list}\` array`;
  for (const [i, entry] of entries.entries()) {
    const reason = entryShapeError(attr, item, i, entry);
    if (reason) return reason;
  }
  return null;
}

function parseEnvelope(json: string): ({ version?: unknown } & Record<string, unknown>) | string {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return `it is not valid JSON (${(err as Error).message})`;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return "it is not a JSON object";
  return raw as { version?: unknown } & Record<string, unknown>;
}

function entryShapeError(
  attr: AudioAttribute,
  item: string,
  i: number,
  entry: unknown,
): string | null {
  if (typeof entry !== "object" || entry === null) return `${item} ${i} is not an object`;
  const fields = entry as Record<string, unknown>;
  if (attr === "data-fx-chain") {
    return typeof fields.type === "string" ? null : `Node ${i} has no effect \`type\``;
  }
  if (typeof fields.target !== "string") return `Lane ${i} has no \`target\``;
  if (!Array.isArray(fields.points)) return `Lane ${i} is missing a \`points\` array`;
  return null;
}

/** An audio attribute the renderer cannot parse fails the whole mix, locally and in the cloud. */
export function findUnreadableAudioAttributeFindings(ctx: LintContext): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  for (const tag of ctx.tags) {
    for (const attr of Object.keys(AUDIO_ATTRIBUTES) as AudioAttribute[]) {
      const value = readDecodedAttr(tag.raw, attr);
      if (value === null || value === "") continue;
      const reason = audioAttributeShapeError(attr, value);
      if (!reason) continue;
      const id = readAttr(tag.raw, "id");
      const { list } = AUDIO_ATTRIBUTES[attr];
      findings.push({
        code: "audio_attribute_unreadable",
        severity: "error",
        message: `${id ? `#${id}` : `<${tag.name}>`} has a \`${attr}\` the render cannot read: ${reason}. The render fails on it, locally and in the cloud.`,
        elementId: id || undefined,
        fixHint: `Write it as {"version": ${AUDIO_ATTRIBUTE_VERSION}, "${list}": [...]}, or remove the attribute.`,
        snippet: truncateSnippet(tag.raw),
      });
    }
  }
  return findings;
}
