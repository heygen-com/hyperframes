/**
 * Internal helper for scoping the player's media MutationObserver to the
 * composition tree inside the iframe.
 *
 * Not part of the package's public API — kept in its own module so the
 * decision logic can be exercised by unit tests without exposing it through
 * the player entry point.
 */

/**
 * Pick the elements inside `doc` that the media MutationObserver should
 * attach to.
 *
 * Compositions mount inside `[data-composition-id]` host elements — the
 * runtime root and any sub-composition hosts that `compositionLoader` writes
 * into them. Watching only those hosts (with `subtree: true`) catches every
 * late-arriving timed media element from sub-composition activation, while
 * filtering out churn from analytics tags, runtime telemetry markers, and
 * other out-of-host nodes that the runtime appends straight to `<body>`
 * during bootstrap.
 *
 * Nested hosts are filtered out — they're already covered by their nearest
 * host ancestor's subtree observation, so observing them too would deliver
 * each callback twice and double-count adoption work.
 *
 * Falls back to `[doc.body]` when no composition hosts are present, which
 * preserves the previous behavior for documents that aren't yet (or never
 * will be) composition-structured. Returns an empty array when neither a
 * host nor a body is available — the caller should treat that as "nothing
 * to observe".
 *
 * When the scoped path is taken but the body still carries timed media
 * outside every host, a `console.warn` fires once per call as a forensic
 * signal: the new scope skips that media, so any `<audio data-start>` /
 * `<video data-start>` injected at body level will silently never get a
 * parent-frame proxy. Today every runtime path appends inside a host so
 * this branch shouldn't trip; if it does, the warn surfaces the drift
 * immediately rather than presenting as a missing-audio bug downstream.
 */
export function selectMediaObserverTargets(doc: Document): Element[] {
  const all = Array.from(doc.querySelectorAll<Element>("[data-composition-id]"));
  if (all.length === 0) {
    return doc.body ? [doc.body] : [];
  }

  const topLevel: Element[] = [];
  for (const el of all) {
    if (!hasCompositionAncestor(el)) {
      topLevel.push(el);
    }
  }

  warnOnUnscopedTimedMedia(doc);
  return topLevel;
}

/**
 * Forensic guard: with composition hosts present the observer attaches only
 * to those subtrees, so any timed media sitting at body level (or under a
 * non-host wrapper) is invisible to the adoption pipeline. Walk the body for
 * `[data-start]` audio/video that has no `[data-composition-id]` ancestor
 * and emit a single `console.warn` listing the orphans. The walk is cheap
 * (one `querySelectorAll` over a typed selector + a `closest` per match)
 * and only runs on the scoped path, so the no-host fallback retains its
 * legacy behavior with zero extra work.
 */
function warnOnUnscopedTimedMedia(doc: Document): void {
  const body = doc.body;
  if (!body) return;
  if (typeof console === "undefined" || typeof console.warn !== "function") return;

  const candidates = body.querySelectorAll<HTMLMediaElement>(
    "audio[data-start], video[data-start]",
  );
  if (candidates.length === 0) return;

  const orphans: HTMLMediaElement[] = [];
  for (const el of candidates) {
    if (!el.closest("[data-composition-id]")) orphans.push(el);
  }
  if (orphans.length === 0) return;

  console.warn(
    "[hyperframes-player] selectMediaObserverTargets: composition hosts are present, " +
      `but ${orphans.length} body-level timed media element(s) sit outside every ` +
      "[data-composition-id] subtree and will not be observed. Move them inside a " +
      "composition host or the parent-frame proxy will never adopt them.",
    orphans,
  );
}

function hasCompositionAncestor(el: Element): boolean {
  let cursor = el.parentElement;
  while (cursor) {
    if (cursor.hasAttribute("data-composition-id")) return true;
    cursor = cursor.parentElement;
  }
  return false;
}
