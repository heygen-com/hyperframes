/**
 * Local catalog search that costs nothing and needs no account.
 *
 * Replaces a substring test. `description.includes(query)` cannot answer "make
 * the pace suddenly feel faster" because no description contains that phrase,
 * so the honest result was zero matches. Scoring shared vocabulary answers it
 * partially, offline, with no model and no network.
 *
 * The scorer is the one the retrieval evaluation used: lowercase tokens, stop
 * words dropped, anything three characters or shorter dropped, and the shared
 * token count divided by the square root of the entry's token count. That
 * divisor is load-bearing. Without it the wordiest entry wins every query on
 * sheer surface area.
 *
 * Two things sit on top of that, both measured against a fixed eval set of
 * catalog queries rather than adjusted by feel:
 *
 * 1. A token matching an item's NAME or TITLE counts for more than one
 *    matching its description. Without this, searching "typewriter effect on a
 *    title" ranked the item literally called `typewriter` seventh, behind
 *    entries that merely mention typing. An author who types a move's name is
 *    giving the strongest signal available and it was being averaged away.
 *
 * 2. Plurals fold to their singular on both sides. "a stat that counts up and
 *    then pulses once" shares no token with a description reading "lands with
 *    a restrained scale pulse", because `counts` is not `count` and `pulses`
 *    is not `pulse`. Adding detail to a query made results strictly worse,
 *    which is the opposite of what a search should do.
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

/** How much more a name/title token is worth than a description token. */
const STRONG_FIELD_WEIGHT = 3;

/**
 * Fold a plural to its singular, and nothing else.
 *
 * Deliberately not a real stemmer. Porter would fold `counter` to `count` and
 * `values` to `valu`, which merges moves that mean different things and makes
 * the failure harder to read when it happens. Plurals are the case that
 * actually bit: every extra descriptive word an author adds tends to arrive
 * pluralised while the catalog writes its descriptions in the singular.
 */
const PLURAL_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/([^aeiou])ies$/, "$1y"], // stories -> story
  [/(ch|sh|ss|x)es$/, "$1"], // matches -> match, glasses -> glass
  [/(ss|us|is)$/, "$&"], // press, status, axis: the trailing s is not a plural
  [/s$/, ""], // counts -> count, pulses -> pulse
];

function singularize(word: string): string {
  if (word.length <= 3) return word;
  // First rule wins, so the guard above `s$` is what protects press and status.
  for (const [pattern, replacement] of PLURAL_RULES) {
    if (pattern.test(word)) return word.replace(pattern, replacement);
  }
  return word;
}

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.filter((word) => word.length > 2 && !STOP.has(word)).map(singularize);
}

/**
 * True when a query contains no token this ranker can search on.
 *
 * The catalog is written in English and tokenising on `[a-z]+` means a query
 * in another script produces nothing at all. That used to be indistinguishable
 * from "the catalog has nothing like this", so a Japanese query printed the
 * same "no items match" as a genuine gap and sent the author off to report a
 * missing move that may well exist. Callers use this to say which of the two
 * actually happened.
 */
export function hasNoSearchableTokens(query: string): boolean {
  return tokenize(query).length === 0 && query.trim().length > 0;
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** The searchable text of an item, split by how much a match in it counts. */
export interface ItemText {
  /** Name and title: what an author types when they know what they want. */
  strong: string;
  /** Description, tags, everything else. */
  weak: string;
}

/**
 * Reconcile the two spellings of one compound word.
 *
 * The tokenizer splits on word boundaries, so `countdown` is one token and
 * `count down` is two, and neither can ever match the other. That made the two
 * spellings of a single idea return disjoint result sets: `countdown` returned
 * only the one item tagged with that exact word, while `count down timer`
 * returned sixteen that did not include it. Whichever phrasing an author
 * happened to type decided which half of the answer they saw, and neither half
 * was the whole answer.
 *
 * Both directions, and both gated on the catalog's own vocabulary so this can
 * only ever add signal:
 *
 * - A query token is split when both halves are words the catalog actually
 *   uses. The compound is always kept, so nothing is lost: `countdown` is rare
 *   and keeps its high inverse-document-frequency weight, while the common
 *   halves it adds bring in the items written the other way and carry almost
 *   no weight of their own. That is why splitting `typewriter` into `type` and
 *   `writer` cannot dislodge the item literally called typewriter.
 * - Adjacent query tokens are joined when the compound is a word the catalog
 *   actually uses, so `count down` also reaches items written `countdown`.
 *
 * A word in neither form, like `timer` (which appears in none of the catalog's
 * items), is left exactly as it was: this widens phrasing, it does not invent
 * matches.
 *
 * Everything added here is INFERRED rather than asked for, so it carries a
 * fraction of a real token's weight. Without that the inference can outvote the
 * question: `type` matching the name of `type-match-cut` at full strength beats
 * `typewriter` matching the name of `typewriter`, and searching a word returns
 * something that merely contains half of it. Relying on the halves being
 * statistically common in a large catalog is not the same as making them
 * count for less, and only one of the two holds when the corpus is small.
 */
const INFERRED_TOKEN_WEIGHT = 0.35;

function expandCompounds(
  want: Map<string, number>,
  order: string[],
  vocabulary: Set<string>,
): void {
  const infer = (token: string): void => {
    if (!want.has(token)) want.set(token, INFERRED_TOKEN_WEIGHT);
  };

  for (const token of order) {
    if (token.length < 6) continue;
    // Shortest useful part is 3 characters, matching the tokenizer's own floor.
    for (let cut = 3; cut <= token.length - 3; cut++) {
      const head = token.slice(0, cut);
      const tail = token.slice(cut);
      if (vocabulary.has(head) && vocabulary.has(tail)) {
        infer(head);
        infer(tail);
        break;
      }
    }
  }
  for (let i = 0; i < order.length - 1; i++) {
    const joined = `${order[i]}${order[i + 1]}`;
    if (vocabulary.has(joined)) infer(joined);
  }
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
  textOf: (item: T) => ItemText,
): Scored<T>[] {
  const asked = tokenize(query);
  // Token -> how much a match on it is worth. Asked-for words count fully;
  // words inferred from a compound count for a fraction.
  const want = new Map<string, number>(asked.map((token) => [token, 1]));
  if (want.size === 0) return items.map((item) => ({ item, score: 0 }));

  const parsed = items.map((item) => {
    const { strong, weak } = textOf(item);
    const strongTokens = new Set(tokenize(strong));
    return { item, strongTokens, allTokens: new Set([...strongTokens, ...tokenize(weak)]) };
  });

  const vocabulary = new Set<string>();
  for (const entry of parsed) for (const token of entry.allTokens) vocabulary.add(token);
  expandCompounds(want, asked, vocabulary);

  // How rare each queried word is across the catalog. Without this a common
  // word carries the same weight as a distinctive one, and field weighting
  // makes that worse rather than better: searching "reveal a headline one line
  // at a time" put every item merely NAMED `*-reveal` on top, because one
  // strong hit on the catalog's most common word outscored several weak hits
  // on the words that actually narrowed it down.
  const idf = new Map<string, number>();
  for (const token of want.keys()) {
    const df = parsed.reduce((count, p) => count + (p.allTokens.has(token) ? 1 : 0), 0);
    // +1 inside the log keeps a token present in every item at a small
    // positive weight rather than exactly zero: still nearly worthless, but
    // never able to flip a tie on its own.
    idf.set(token, Math.log((parsed.length + 1) / (df + 1)) + 1);
  }

  return parsed
    .map(({ item, strongTokens, allTokens }) => {
      let shared = 0;
      for (const [token, asking] of want) {
        const weight = (idf.get(token) ?? 1) * asking;
        if (strongTokens.has(token)) shared += STRONG_FIELD_WEIGHT * weight;
        else if (allTokens.has(token)) shared += weight;
      }
      // sqrt normalization: a longer entry has more chances to overlap, and
      // without this the wordiest blurb ranks first for every query. Measured
      // over the whole token set, so weighting a field cannot be gamed by
      // moving words into the name.
      return { item, score: shared / (Math.sqrt(allTokens.size) || 1) };
    })
    .sort((a, b) => b.score - a.score || nameOf(b.item).localeCompare(nameOf(a.item)));
}

/** Only items sharing at least one token, best first. */
export function searchByWords<T>(query: string, items: T[], textOf: (item: T) => ItemText): T[] {
  return rankByWords(query, items, textOf)
    .filter((scored) => scored.score > 0)
    .map((scored) => scored.item);
}

function nameOf(item: unknown): string {
  const named = item as { name?: unknown };
  return typeof named?.name === "string" ? named.name : "";
}
