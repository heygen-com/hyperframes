// Shared lexical-matching helpers used by both the assets/ scan (adopt.mjs) and
// the reuse-candidate ranker (candidates.mjs), and the type-equivalence check
// used by resolve.mjs and candidates.mjs. Kept in one place so the icon<->image
// equivalence and the token rules can't drift between the "do" path (resolve)
// and the "look" path (candidates).

// Common filler words that should never, on their own, make two strings match.
const MATCH_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "our",
]);

// Split into lowercased word tokens of length >= 3, minus stopwords.
export function matchTokens(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !MATCH_STOPWORDS.has(t)),
  );
}

// Count of shared meaningful word tokens between two strings. 0 = no lexical
// overlap (the candidate ranker still surfaces these, ordered after overlaps).
export function tokenOverlap(a, b) {
  const ta = matchTokens(a);
  const tb = matchTokens(b);
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n;
}

// icon, image, and logo are interchangeable: all live in images/, and
// figma-imported brand marks are recorded as type image while agents ask for
// logos as icon or logo.
export function typesMatch(a, b) {
  if (a === b) return true;
  const visual = new Set(["icon", "image", "logo"]);
  return visual.has(a) && visual.has(b);
}
