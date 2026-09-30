/**
 * Label colours for link groups. Teal, violet, white and red are taken (visual
 * clips, audio clips, selection, the out-of-sync badge), so none appear here.
 */
export const LINK_LABEL_COLORS = [
  "#f59e0b",
  "#38bdf8",
  "#a3e635",
  "#f472b6",
  "#fb923c",
  "#facc15",
] as const;

function stableIndex(link: string): number {
  const numbered = /^lk-(\d+)$/.exec(link);
  if (numbered) return Number(numbered[1]) - 1;
  let hash = 0;
  for (const char of link) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/** The same colour for every member of a link group, from its id alone. */
export function linkLabelColor(link: string | undefined): string | null {
  if (!link) return null;
  const count = LINK_LABEL_COLORS.length;
  return LINK_LABEL_COLORS[((stableIndex(link) % count) + count) % count] ?? null;
}
