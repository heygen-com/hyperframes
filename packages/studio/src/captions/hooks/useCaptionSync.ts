import { useCallback, useRef } from "react";
import { useCaptionStore } from "../store";
import type { CaptionStyle } from "../types";

/**
 * Build gsap props object string for a word element's style overrides.
 */
function buildGsapProps(style: Partial<CaptionStyle>): string | null {
  const props: string[] = [];
  if (style.x !== undefined) props.push(`x: ${style.x.toFixed(1)}`);
  if (style.y !== undefined) props.push(`y: ${style.y.toFixed(1)}`);
  if (style.scaleX !== undefined) props.push(`scale: ${style.scaleX.toFixed(3)}`);
  if (style.rotation !== undefined) props.push(`rotation: ${style.rotation.toFixed(1)}`);
  if (style.color !== undefined) props.push(`color: "${style.color}"`);
  if (style.opacity !== undefined) props.push(`opacity: ${style.opacity}`);
  if (style.fontSize !== undefined) props.push(`fontSize: "${style.fontSize}px"`);
  if (style.fontWeight !== undefined) props.push(`fontWeight: ${style.fontWeight}`);
  if (props.length === 0) return null;
  return `{ ${props.join(", ")} }`;
}

const PATCH_START = "// -- Caption Editor Overrides (auto-generated) --";
const PATCH_END = "// -- End Caption Editor Overrides --";

/**
 * Generate a patch block that adds tl.set() overrides to the GSAP timeline.
 * Uses each word's start time from the transcript so the overrides apply
 * AFTER the entrance animation, preventing the timeline from overwriting them.
 * Also adds a standalone gsap.set() for the initial seek-to-0 state.
 */
function generatePatchBlock(model: {
  groupOrder: string[];
  groups: Map<string, { segmentIds: string[] }>;
  segments: Map<string, { start: number; end: number; style: Partial<CaptionStyle> }>;
}): string | null {
  const entries: Array<{ elementId: string; startTime: number; endTime: number; props: string }> = [];
  for (let gi = 0; gi < model.groupOrder.length; gi++) {
    const group = model.groups.get(model.groupOrder[gi]);
    if (!group) continue;
    for (let wi = 0; wi < group.segmentIds.length; wi++) {
      const seg = model.segments.get(group.segmentIds[wi]);
      if (!seg || Object.keys(seg.style).length === 0) continue;
      const props = buildGsapProps(seg.style);
      if (!props) continue;
      entries.push({ elementId: `w-${gi}-${wi}`, startTime: seg.start, endTime: seg.end, props });
    }
  }
  if (entries.length === 0) return null;

  // Determine which GSAP properties each entry overrides
  function overriddenGsapProps(props: string): string[] {
    const out: string[] = [];
    if (props.includes("x:")) out.push("x");
    if (props.includes("y:")) out.push("y");
    if (props.includes("scale:")) out.push("scale");
    if (props.includes("rotation:")) out.push("rotation");
    return out;
  }

  const lines: string[] = [];
  lines.push("      " + PATCH_START);
  lines.push("      // For each edited word: selectively kill only the transform properties");
  lines.push("      // that the editor overrides, preserving opacity/color/karaoke tweens.");
  lines.push("      (function() {");
  lines.push("        var tl = window.__timelines && window.__timelines['captions'];");
  lines.push("        if (!tl) return;");
  for (const e of entries) {
    const v = `el_${e.elementId.replace(/-/g, "_")}`;
    const killProps = overriddenGsapProps(e.props);
    lines.push(`        var ${v} = document.getElementById("${e.elementId}");`);
    lines.push(`        if (${v}) {`);
    // Use GSAP's property-specific kill: killTweensOf(target, "x,y")
    // This kills only the specific properties, leaving opacity/color/textShadow intact
    lines.push(`          gsap.killTweensOf(${v}, "${killProps.join(",")}");`);
    // Apply our values
    lines.push(`          gsap.set(${v}, ${e.props});`);
    lines.push("        }");
  }
  lines.push("      })();");
  lines.push("      " + PATCH_END);
  return lines.join("\n");
}

function applyPatchToSource(source: string, patchBlock: string | null): string {
  // Remove existing patch block
  const startIdx = source.indexOf(PATCH_START);
  const endIdx = source.indexOf(PATCH_END);
  let cleaned = source;
  if (startIdx >= 0 && endIdx >= 0) {
    cleaned = source.slice(0, startIdx).trimEnd() + "\n" + source.slice(endIdx + PATCH_END.length);
  }
  if (!patchBlock) return cleaned;
  const lastScriptClose = cleaned.lastIndexOf("</script>");
  if (lastScriptClose < 0) return cleaned;
  return (
    cleaned.slice(0, lastScriptClose).trimEnd() +
    "\n\n" + patchBlock + "\n    " +
    cleaned.slice(lastScriptClose)
  );
}

/**
 * Hook that provides a manual save function for caption edits.
 * Does NOT auto-save — call `save()` explicitly.
 */
export function useCaptionSync(projectId: string | null) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const originalSourceRef = useRef<string | null>(null);

  /** Cache the original source when entering edit mode */
  const cacheOriginalSource = useCallback(async () => {
    const state = useCaptionStore.getState();
    const pid = projectIdRef.current;
    if (!pid || !state.sourceFilePath) return;
    const res = await fetch(
      `/api/projects/${pid}/files/${encodeURIComponent(state.sourceFilePath)}`,
    );
    const data = await res.json();
    if (!data.content) return;
    // Strip existing patches to get clean source
    let clean = data.content as string;
    const si = clean.indexOf(PATCH_START);
    const ei = clean.indexOf(PATCH_END);
    if (si >= 0 && ei >= 0) {
      clean = clean.slice(0, si).trimEnd() + "\n" + clean.slice(ei + PATCH_END.length);
    }
    originalSourceRef.current = clean;
  }, []);

  /** Save current edits as patches to the source file */
  const save = useCallback(async () => {
    const state = useCaptionStore.getState();
    if (!state.model || !state.sourceFilePath) return;
    const pid = projectIdRef.current;
    if (!pid) return;

    // Ensure we have the original source
    if (!originalSourceRef.current) {
      await cacheOriginalSource();
    }
    if (!originalSourceRef.current) return;

    const patchBlock = generatePatchBlock(state.model);
    const patched = applyPatchToSource(originalSourceRef.current, patchBlock);

    await fetch(
      `/api/projects/${pid}/files/${encodeURIComponent(state.sourceFilePath)}`,
      { method: "PUT", headers: { "Content-Type": "text/plain" }, body: patched },
    );
  }, [cacheOriginalSource]);

  /** Clear cached source when exiting edit mode */
  const clearCache = useCallback(() => {
    originalSourceRef.current = null;
  }, []);

  return { save, cacheOriginalSource, clearCache };
}
