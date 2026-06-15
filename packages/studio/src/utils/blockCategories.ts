import {
  type BlockCategory,
  BLOCK_CATEGORIES,
  resolveBlockCategory,
} from "@hyperframes/core/registry";

export type { BlockCategory };
export { BLOCK_CATEGORIES, resolveBlockCategory };

const COLOR_MAP: Record<BlockCategory, { bg: string; text: string; dot: string }> = {
  transitions: { bg: "bg-blue-500/15", text: "text-blue-400", dot: "bg-blue-400" },
  vfx: { bg: "bg-purple-500/15", text: "text-purple-400", dot: "bg-purple-400" },
  social: { bg: "bg-pink-500/15", text: "text-pink-400", dot: "bg-pink-400" },
  data: { bg: "bg-green-500/15", text: "text-green-400", dot: "bg-green-400" },
  scenes: { bg: "bg-amber-500/15", text: "text-amber-400", dot: "bg-amber-400" },
  captions: { bg: "bg-cyan-500/15", text: "text-cyan-400", dot: "bg-cyan-400" },
  effects: { bg: "bg-rose-500/15", text: "text-rose-400", dot: "bg-rose-400" },
  "text-effects": { bg: "bg-violet-500/15", text: "text-violet-400", dot: "bg-violet-400" },
  "code-animation": { bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-400" },
};

export function getCategoryColors(category: BlockCategory) {
  return COLOR_MAP[category];
}
