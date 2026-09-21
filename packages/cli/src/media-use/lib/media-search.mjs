const STOP = new Set(
  (
    "the a an and or of to in on at is are be it its for with that this as by from into " +
    "one two must not no all over under across while when where which who whom whose they " +
    "them their we our you your he she his her but if then than so such can may might will " +
    "would should each other another same both few more most some any every"
  ).split(" "),
);

const PLURAL_RULES = [
  [/([^aeiou])ies$/, "$1y"],
  [/(ch|sh|ss|x)es$/, "$1"],
  [/(ss|us|is)$/, "$&"],
  [/s$/, ""],
];
const STRONG_FIELD_WEIGHT = 3;
const INFERRED_TOKEN_WEIGHT = 0.35;

function singularize(word) {
  if (word.length <= 3) return word;
  for (const [pattern, replacement] of PLURAL_RULES) {
    if (pattern.test(word)) return word.replace(pattern, replacement);
  }
  return word;
}

function tokenize(text) {
  const words =
    String(text)
      .toLowerCase()
      .match(/[a-z]+/g) || [];
  return words.filter((word) => word.length > 2 && !STOP.has(word)).map(singularize);
}

export function rankMediaRows(query, rows) {
  const asked = tokenize(query);
  const normalizedLiteralQuery = String(query).trim().toLowerCase();
  const normalizedQuery = asked.join(" ");
  const want = new Map(asked.map((token) => [token, 1]));
  if (want.size === 0) return [];

  const parsed = rows.map((row) => {
    const strongTokens = new Set(tokenize(`${row.id} ${row.title}`));
    const allTokens = new Set([
      ...strongTokens,
      ...tokenize(`${row.description} ${row.tags.join(" ")} ${row.kind}`),
    ]);
    return {
      row,
      strongTokens,
      allTokens,
      literalId: row.id.trim().toLowerCase() === normalizedLiteralQuery,
      stemmedId: tokenize(row.id).join(" ") === normalizedQuery,
    };
  });
  const vocabulary = new Set(parsed.flatMap(({ allTokens }) => [...allTokens]));
  for (const token of asked) {
    if (token.length < 6) continue;
    for (let cut = 3; cut <= token.length - 3; cut++) {
      const head = token.slice(0, cut);
      const tail = token.slice(cut);
      if (vocabulary.has(head) && vocabulary.has(tail)) {
        want.set(head, INFERRED_TOKEN_WEIGHT);
        want.set(tail, INFERRED_TOKEN_WEIGHT);
        break;
      }
    }
  }
  for (let index = 0; index < asked.length - 1; index++) {
    const joined = `${asked[index]}${asked[index + 1]}`;
    if (vocabulary.has(joined)) want.set(joined, INFERRED_TOKEN_WEIGHT);
  }

  const idf = new Map();
  for (const token of want.keys()) {
    const documentFrequency = parsed.filter(({ allTokens }) => allTokens.has(token)).length;
    idf.set(token, Math.log((parsed.length + 1) / (documentFrequency + 1)) + 1);
  }
  return parsed
    .map(({ row, strongTokens, allTokens, literalId, stemmedId }) => {
      let score = 0;
      for (const [token, asking] of want) {
        const weight = (idf.get(token) || 1) * asking;
        if (strongTokens.has(token)) score += STRONG_FIELD_WEIGHT * weight;
        else if (allTokens.has(token)) score += weight;
      }
      return { row, score, literalId, stemmedId };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        Number(b.literalId) - Number(a.literalId) ||
        Number(b.stemmedId) - Number(a.stemmedId) ||
        b.score - a.score,
    )
    .map(({ row }) => row);
}

export async function rankMediaRowsWithVectors(query, rows, semanticRanking) {
  const words = rankMediaRows(query, rows);
  if (words.length > 0) return { rows: words, tier: "words" };
  if (!semanticRanking) return { rows: [], tier: "words" };
  const semantic = await semanticRanking(query, rows);
  return semantic
    ? { rows: semantic.map(({ row }) => row), tier: "on-device" }
    : { rows: [], tier: "words" };
}
