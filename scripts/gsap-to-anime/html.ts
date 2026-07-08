import type { ScriptBlock } from "./types.ts";

const INLINE_SCRIPT_RE = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

export function findGsapScriptBlock(html: string): ScriptBlock | null {
  let best: ScriptBlock | null = null;
  let bestScore = -1;
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const fullMatch = match[0];
    const scriptText = match[1] ?? "";
    const matchIndex = match.index;
    if (matchIndex === undefined) continue;
    if (!scriptText.includes("gsap.timeline")) continue;
    const openTagEnd = fullMatch.indexOf(">") + 1;
    const block = {
      scriptText,
      start: matchIndex + openTagEnd,
      end: matchIndex + fullMatch.length - "</script>".length,
    };
    const score = timelineMethodScore(scriptText);
    if (score > bestScore) {
      best = block;
      bestScore = score;
    }
  }
  return best;
}

export function replaceScriptBlock(html: string, block: ScriptBlock, scriptText: string): string {
  return `${html.slice(0, block.start)}${scriptText}${html.slice(block.end)}`;
}

function timelineMethodScore(scriptText: string): number {
  let score = 0;
  for (const match of scriptText.matchAll(/\.(?:set|to|from|fromTo)\s*\(/g)) {
    if (match[0]) score += 1;
  }
  return score;
}
