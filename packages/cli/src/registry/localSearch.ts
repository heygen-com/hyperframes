/**
 * Local catalog search that costs nothing and needs no account.
 *
 * Replaces a substring test. `description.includes(query)` cannot answer "make
 * the pace suddenly feel faster" because no description contains that phrase,
 * so the honest result was zero matches. Scoring shared vocabulary answers it
 * partially, offline, with no model and no network.
 *
 * The scorer is the one the retrieval evaluation used, reproduced so the local
 * arm and the remote fallback rank identically rather than merely similarly:
 * lowercase alphabetic tokens, stop words dropped, anything three characters or
 * shorter dropped, and the shared-token count divided by the square root of the
 * entry's token count. That divisor is load-bearing. Without it the wordiest
 * entry wins every query on sheer surface area.
 *
 * Ties break on descending name, matching the evaluation's sort.
 */

/** Dropped from both sides before scoring. Without this every entry matches on "the". */
const STOP = new Set(
  (
    "the a an and or of to in on at is are be it its for with that this as by from into " +
    "one two must not no all over under across while when where which who whom whose they " +
    "them their we our you your he she his her but if then than so such can may might will " +
    "would should each other another same both few more most some any every"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.filter((word) => word.length > 2 && !STOP.has(word));
}

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Rank every item by shared vocabulary, best first.
 *
 * Returns all items rather than only matches, so a caller can decide where to
 * cut. Items scoring zero sort last.
 */
export function rankByWords<T>(
  query: string,
  items: T[],
  textOf: (item: T) => string,
): Scored<T>[] {
  const want = new Set(tokenize(query));
  if (want.size === 0) return items.map((item) => ({ item, score: 0 }));

  return items
    .map((item) => {
      const have = new Set(tokenize(textOf(item)));
      let shared = 0;
      for (const token of want) if (have.has(token)) shared += 1;
      // sqrt normalization: a longer entry has more chances to overlap, and
      // without this the wordiest blurb ranks first for every query.
      return { item, score: shared / (Math.sqrt(have.size) || 1) };
    })
    .sort((a, b) => b.score - a.score || nameOf(b.item).localeCompare(nameOf(a.item)));
}

/** Only items sharing at least one token, best first. */
export function searchByWords<T>(query: string, items: T[], textOf: (item: T) => string): T[] {
  return rankByWords(query, items, textOf)
    .filter((scored) => scored.score > 0)
    .map((scored) => scored.item);
}

function nameOf(item: unknown): string {
  const named = item as { name?: unknown };
  return typeof named?.name === "string" ? named.name : "";
}
