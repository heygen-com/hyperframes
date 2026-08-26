/**
 * Document-unique identity for media elements in a compiled render document.
 *
 * Element `id`s are only unique within one composition FILE. The render
 * document is the inlined union of every file, so ids collide there in two
 * ways an author cannot avoid:
 *
 * 1. Two scenes each declare `<video id="clip">` — legal per file, duplicated
 *    once inlined.
 * 2. Two scenes each declare a bare `<video>` — the timing compiler numbers
 *    auto-ids per file, so both become `hf-video-0`.
 *
 * The render pipeline keys media on that id (extract, inject, visibility,
 * bounds), so a collision collapses N elements into one entry and every
 * lookup resolves to whichever element happens to come first in the document.
 * The surviving clip's frames land on the wrong element and the visible scene
 * paints without footage.
 *
 * This module is the single owner of the fix: after inlining, every media
 * element gets a document-unique `data-hf-render-id`. It equals the element's
 * own id whenever that id is already unique, so uncolliding documents keep
 * byte-identical pipeline keys and log output. Author-visible `id` attributes
 * are never rewritten — 158 of the 161 registry blocks reference their own ids
 * from `#id` CSS or `getElementById`, so renaming would break scene styling to
 * fix scene footage.
 */

export const MEDIA_RENDER_ID_ATTR = "data-hf-render-id";

/**
 * The bus a member belongs to, as a DOCUMENT-unique key.
 *
 * `data-audio-group` names a bus by author id, unique only per composition FILE
 * — so a sub-composition that declares a bus AND its members, used twice, put
 * both instances' members under one key and let the second bus element
 * overwrite the first. The mixer then sub-mixed two independent buses as one,
 * applied instance B's fader, chain and label to instance A's audio, and — with
 * only B muted — dropped BOTH instances from the export. This attribute is that
 * collision resolved at the same boundary the media ids are.
 */
export const AUDIO_GROUP_RENDER_ID_ATTR = "data-hf-group-render-id";

/**
 * Elements the render pipeline addresses by id.
 *
 * `<video>`/`<audio>` are matched even with an empty `src`. Authors assign the
 * URL from the scene script (`el.src = url`); the static parse then skips them
 * and the browser snapshot has to pair the clips. Without a render id on those
 * elements the snapshot keys by raw id and colliding scenes collapse. `<img>`
 * still requires a `src` attribute (empty is enough) so we do not stamp every
 * decorative image.
 */
const MEDIA_SELECTOR = "video, audio, img[src]";

/** Buses, which are addressed by id in exactly the same way and collide the
 *  same way. Only an id'd bus can be joined at all. */
const AUDIO_GROUP_SELECTOR = "hf-audio-group[id]";

interface MediaElementLike {
  readonly tagName?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/** A bus or member, which additionally needs subtree scoping to be paired up. */
interface ScopedElementLike extends MediaElementLike {
  closest?(selector: string): ScopedElementLike | null;
}

interface DocumentLike {
  querySelectorAll(selector: string): Iterable<MediaElementLike>;
}

/**
 * Derive a document-unique render id from an element's own id.
 *
 * `taken` accumulates every id handed out so far, including the plain ids of
 * elements that have not been visited yet is NOT required: a later element
 * whose plain id was already claimed simply gets a suffix. Document order
 * therefore decides who keeps the plain id, which keeps the first (and, in the
 * overwhelmingly common single-occurrence case, only) element stable.
 */
function uniqueRenderId(baseId: string, taken: Set<string>): string {
  if (!taken.has(baseId)) return baseId;
  let suffix = 2;
  while (taken.has(`${baseId}__hf${suffix}`)) suffix += 1;
  return `${baseId}__hf${suffix}`;
}

/**
 * Stamp `data-hf-render-id` on every media element in a compiled document.
 *
 * Idempotent: an element that already carries the attribute keeps it, so
 * re-compiling a document (the resolved-durations recompile path) does not
 * renumber ids out from under an in-flight extraction.
 */
export function assignMediaRenderIds(document: DocumentLike): void {
  const taken = new Set<string>();
  const pending: MediaElementLike[] = [];

  for (const el of document.querySelectorAll(MEDIA_SELECTOR)) {
    const existing = el.getAttribute(MEDIA_RENDER_ID_ATTR);
    if (existing) {
      taken.add(existing);
      continue;
    }
    pending.push(el);
  }

  for (const el of pending) {
    const baseId = el.getAttribute("id");
    // An element with no id yet is numbered by the timing compiler before this
    // runs. If one slips through, fall back to a positional id rather than
    // stamping an empty string that every other id-less element would share.
    const renderId = uniqueRenderId(baseId || `hf-media-${taken.size}`, taken);
    taken.add(renderId);
    el.setAttribute(MEDIA_RENDER_ID_ATTR, renderId);
  }

  assignAudioGroupRenderIds(document, taken);
}

/**
 * Give every `<hf-audio-group>` a document-unique render id, and tell each
 * member which INSTANCE of its bus it belongs to.
 *
 * Shares the `taken` set with the media pass, so a bus id and a clip id can
 * never resolve to the same key either.
 *
 * A member is paired to the bus inside its OWN composition subtree. Two
 * instances of the same sub-composition are indistinguishable by
 * `data-composition-id` — both carry the file's own id — so the subtree
 * ELEMENT is the only thing that separates them, which is exactly what
 * `closest()` returns. A member whose bus is not in its subtree (a
 * hand-authored bus in the root composition, members in a scene) falls back to
 * the first bus with that id, which is the pre-existing behaviour and the only
 * sensible reading when there is one bus and several scenes referencing it.
 */
function assignAudioGroupRenderIds(document: DocumentLike, taken: Set<string>): void {
  const busesById = stampAudioGroupBuses(document, taken);
  if (busesById.size === 0) return;

  for (const member of document.querySelectorAll(
    "audio[data-audio-group]",
  ) as Iterable<ScopedElementLike>) {
    const groupId = member.getAttribute("data-audio-group");
    const buses = groupId ? busesById.get(groupId) : undefined;
    if (!groupId || !buses?.length) continue;
    const renderId = busForMember(member, groupId, buses)?.getAttribute(MEDIA_RENDER_ID_ATTR);
    if (renderId) member.setAttribute(AUDIO_GROUP_RENDER_ID_ATTR, renderId);
  }
}

/** Every id'd bus, stamped and indexed by author id — several per id when a
 *  sub-composition that declares one is used more than once. */
function stampAudioGroupBuses(
  document: DocumentLike,
  taken: Set<string>,
): Map<string, ScopedElementLike[]> {
  const busesById = new Map<string, ScopedElementLike[]>();
  for (const bus of document.querySelectorAll(
    AUDIO_GROUP_SELECTOR,
  ) as Iterable<ScopedElementLike>) {
    const id = bus.getAttribute("id");
    if (!id) continue;
    const renderId = bus.getAttribute(MEDIA_RENDER_ID_ATTR) ?? uniqueRenderId(id, taken);
    taken.add(renderId);
    bus.setAttribute(MEDIA_RENDER_ID_ATTR, renderId);
    const existing = busesById.get(id);
    if (existing) existing.push(bus);
    else busesById.set(id, [bus]);
  }
  return busesById;
}

/**
 * Which instance of a bus a member belongs to: the one in its own composition
 * subtree. Falls back to the first when the bus is not in the member's subtree
 * at all — a hand-authored bus in the root composition with members in scenes —
 * which is the pre-existing reading and the only sensible one there.
 */
function busForMember(
  member: ScopedElementLike,
  groupId: string,
  buses: ScopedElementLike[],
): MediaElementLike | undefined {
  if (buses.length === 1) return buses[0];
  const scope = member.closest?.("[data-composition-id]");
  if (!scope) return buses[0];
  // `scope.querySelectorAll()` also sees buses owned by nested compositions.
  // Compare each bus's own nearest composition instead, so a root member does
  // not bind to a same-named bus inside a child merely because the child comes
  // first in document order.
  return (
    buses.find(
      (candidate) =>
        candidate.getAttribute("id") === groupId &&
        candidate.closest?.("[data-composition-id]") === scope,
    ) ?? buses[0]
  );
}
