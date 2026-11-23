/**
 * HDR passthrough overlay fingerprint: a cheap, exact stand-in for "would a
 * screenshot of the overlay at this frame give the same pixels as at that
 * frame".
 *
 * The planner's change frames are a superset of the frames where the overlay
 * really changes: a clip cut claims three frames around its edge, a `set()`
 * one or two, so a single caption cue becomes about eight candidate states
 * of which two render differently. Overlay capture seeks to every candidate
 * (cheap) and reads this fingerprint (cheap); it screenshots (expensive) only
 * when the fingerprint is one it has not captured yet.
 *
 * The fingerprint is everything the overlay's pixels are a function of once
 * eligibility has ruled out the drivers that paint on their own clock
 * (canvas, other videos, iframes, animated images, adapters, SMIL):
 *
 *   - the DOM tree with every attribute (inline styles, GSAP's writes, the
 *     runtime's clip visibility) and every text node, open shadow roots too;
 *   - the CSSOM of every stylesheet, `@import`ed ones included, which
 *     `insertRule` can change without touching the DOM;
 *   - the focused element, which the browser moves when it stops rendering;
 *   - state the DOM does not reflect: element and window scroll, form values,
 *     image load state, font loading status;
 *   - every CSS / Web Animation's play state and current time (a transition
 *     or animation started by a class change differs on every frame, so it
 *     never merges);
 *   - the current value of every native property a GSAP tween writes on its
 *     target element (`scrollTop`, a form value; tweens of anything but
 *     elements decline, `seekReachable.ts`), and the playback position of
 *     a media element with controls;
 *   - the paint state no attribute holds, which a builtin can set with no
 *     page script running: pseudo-classes the browser keeps
 *     (`:popover-open`, `:modal`, `:target`, validity), the custom states
 *     the page's CSS names, the selection, custom highlights, `designMode`;
 *   - the element stacking the layered compositor groups layers from.
 *
 * The passthrough video and its injected replacement frame are left out:
 * their per-frame changes are the video, not the overlay, and the capture
 * masks them. Anything unaccounted for can only make two equal overlays look
 * different (an extra capture), never two different ones look equal, as
 * long as it is in this list.
 *
 * It is collected in a DevTools isolated world (`isolatedWorld.ts`): the page
 * cannot replace anything the collector calls (a page that swapped
 * `JSON.stringify` or `SubtleCrypto#digest` for a constant made an in-page
 * collector hash the same on every frame), and the text is hashed in Node.
 *
 * Page script can still change what paints and none of this reads, and can
 * keep state across seeks; the passthrough declines any page code that runs
 * on capture's seeks (`pageCodeWatch.ts`) and any callback that runs no
 * page script (`seekReachable.ts`, `registrationWatch.ts`), so only the
 * runtime and GSAP write while it probes.
 *
 * Page script cannot read a closed shadow root (`shadowRoot` is null) or the
 * document inside an `<object>` / `<embed>` / frame, so a tween there changes
 * pixels and no fingerprint. Equal fingerprints then merge frames that render
 * differently, and verification accepts them without a screenshot.
 * `findBlindSpotsInSnapshot` finds that content in the DevTools DOM
 * snapshot, which reads both, and the passthrough declines it
 * (`overlay_unreadable`, `overlayPageGates.ts`).
 */

import { createHash } from "node:crypto";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import { type CaptureSession, type ElementStackingInfo, getCdpSession } from "@hyperframes/engine";
import { adoptElements, callIsolated, handleIsolated, type IsolatedArg } from "./isolatedWorld.js";
import type { ElementTarget } from "./seekReachable.js";

/**
 * Runs in the DevTools isolated world (`isolatedWorld.ts`), where page script
 * cannot replace anything it calls; must stay self-contained. Returns the
 * text the caller hashes in Node. Read-only: never seeks, never writes the
 * DOM. `targets` are the elements GSAP tweens write, each followed by the
 * vars keys of its tweens (`seekReachable.ts`).
 */
// fallow-ignore-next-line complexity
export function collectOverlayPageFingerprint(
  videoId: string,
  mediaIdAttribute: string,
  targets: ReadonlyArray<Element | string[]> = [],
): string {
  const parts: string[] = [];
  const skipped = new Set<Node>();
  const escaped = videoId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const video =
    document.querySelector(`[${mediaIdAttribute}="${escaped}"]`) ??
    document.getElementById(videoId);
  if (video) skipped.add(video);
  // Focus paints (`:focus`, `:focus-within`, a caret), and the browser moves it without page code
  // when the focused element stops rendering.
  const focused = new Set<Element>();
  if (document.activeElement) focused.add(document.activeElement);
  for (const img of Array.from(document.querySelectorAll(".__render_frame__"))) skipped.add(img);

  // Every node visited, in order, for the paint state read after the walk.
  const nodeIndex = new Map<Node, number>();
  const elements: Element[] = [];
  // A text control's selection paints (highlighted text, the caret) and no attribute holds it.
  const pushTextSelection = (el: HTMLInputElement | HTMLTextAreaElement) => {
    try {
      parts.push(` @sel=${el.selectionStart},${el.selectionEnd},${el.selectionDirection}`);
    } catch {
      // Input types without a text selection.
    }
  };
  const visitChildren = (node: Node | ShadowRoot) => {
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  // fallow-ignore-next-line complexity
  const visit = (node: Node) => {
    if (skipped.has(node)) {
      parts.push("<~>");
      return;
    }
    if (node.nodeType === 3 || node.nodeType === 4) {
      nodeIndex.set(node, nodeIndex.size);
      parts.push(JSON.stringify((node as CharacterData).data));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    nodeIndex.set(el, nodeIndex.size);
    elements.push(el);
    parts.push(`<${el.tagName}`);
    const inline = (el as Element & { style?: CSSStyleDeclaration }).style;
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === "style" && inline) continue;
      parts.push(` ${attr.name}=${JSON.stringify(attr.value)}`);
    }
    if (inline && inline.length > 0) {
      // The declarations, not the attribute text: the capture mask restores inline
      // visibility after each screenshot, which can reorder it or leave `style=""` behind.
      const declarations: string[] = [];
      for (let i = 0; i < inline.length; i++) {
        const name = inline.item(i);
        declarations.push(
          `${name}:${inline.getPropertyValue(name)}!${inline.getPropertyPriority(name)}`,
        );
      }
      parts.push(` @style=${JSON.stringify(declarations.sort().join(";"))}`);
    }
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
      parts.push(` @scroll=${el.scrollTop},${el.scrollLeft}`);
    }
    if (el instanceof HTMLInputElement) {
      parts.push(` @value=${JSON.stringify(el.value)},${el.checked},${el.indeterminate}`);
      pushTextSelection(el);
    } else if (el instanceof HTMLTextAreaElement) {
      parts.push(` @value=${JSON.stringify(el.value)}`);
      pushTextSelection(el);
    } else if (el instanceof HTMLSelectElement) {
      parts.push(` @selected=${el.selectedIndex}`);
    } else if (el instanceof HTMLImageElement) {
      parts.push(` @img=${el.complete},${el.naturalWidth}x${el.naturalHeight},${el.currentSrc}`);
    } else if (el instanceof HTMLMediaElement && el.controls) {
      // Controls paint the playback position, which the runtime sets on every seek.
      parts.push(` @media=${el.currentTime},${el.paused},${el.muted},${el.volume},${el.duration}`);
    }
    if (focused.has(el)) parts.push(" @focus");
    parts.push(">");
    const shadow = el.shadowRoot;
    if (shadow) {
      if (shadow.activeElement) focused.add(shadow.activeElement);
      parts.push("<#shadow>");
      visitChildren(shadow);
      // A shadow root's own <style> sheets are not in document.styleSheets; insertRule (or a
      // tween of one of their rules) changes them without touching the DOM text.
      for (const sheet of Array.from(shadow.styleSheets ?? [])) pushSheet(sheet);
      for (const sheet of shadow.adoptedStyleSheets ?? []) pushSheet(sheet);
      // Not in document.getAnimations().
      pushAnimations(shadow);
      parts.push("</#shadow>");
    }
    // Script and noscript text never paints (scripts already ran; scripting is on). The
    // runtime's own script alone is megabytes, which this probe would otherwise hash every frame.
    if (el.localName !== "script" && el.localName !== "noscript") visitChildren(el);
    parts.push("</>");
  };
  const pushAnimations = (scope: Document | ShadowRoot) => {
    try {
      for (const animation of scope.getAnimations()) {
        parts.push(`@anim ${animation.playState},${String(animation.currentTime)}`);
      }
    } catch {
      // Unreadable animations cannot be proven equal: make this probe unique.
      parts.push(`@anim unreadable ${Math.random()}`);
    }
  };
  // The custom states (`:state(x)`, legacy `:--x`) the page's CSS names: only those can paint.
  const customStates = new Set<string>();
  const noteCustomStates = (cssText: string) => {
    for (const m of cssText.matchAll(/:state\(\s*([^)\s]+)\s*\)|:--([\w-]+)/g)) {
      customStates.add(m[1] ? `:state(${m[1]})` : `:--${m[2]}`);
    }
  };
  const sheetsSeen = new Set<CSSStyleSheet>();
  const pushSheet = (sheet: CSSStyleSheet) => {
    if (sheetsSeen.has(sheet)) return;
    sheetsSeen.add(sheet);
    parts.push(`@sheet ${sheet.disabled ? "off" : "on"} ${sheet.media?.mediaText ?? ""}`);
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        parts.push(rule.cssText);
        noteCustomStates(rule.cssText);
        // An @import's own rules are not in its cssText.
        const imported = (rule as CSSRule & { styleSheet?: CSSStyleSheet | null }).styleSheet;
        if (imported) pushSheet(imported);
      }
    } catch {
      // A cross-origin sheet cannot change without its <link> changing, which the DOM walk sees.
      parts.push(`@opaque ${sheet.href ?? ""}`);
    }
  };

  // Paint state that no attribute, text or style holds, which a builtin can change with no page
  // script running (a bound `showPopover`, `selectAllChildren` or `CustomStateSet#add` handed to
  // an observer): pseudo-classes the browser keeps, the custom states the page's CSS names, the
  // document selection, custom highlights, the URL fragment (`:target`) and `designMode`.
  const STATE_SELECTORS = [
    ":popover-open",
    ":modal",
    ":open",
    ":target",
    ":target-within",
    ":fullscreen",
    ":picture-in-picture",
    ":autofill",
    ":user-invalid",
    ":user-valid",
    ":invalid",
    "option:checked",
    ":default",
    ":focus-visible",
    ":not(:defined)",
  ];
  const where = (node: Node | null | undefined) =>
    !node ? "-" : node === document ? "doc" : String(nodeIndex.get(node) ?? `?${node.nodeName}`);
  const pushRanges = (label: string, ranges: Iterable<AbstractRange>) => {
    for (const r of ranges) {
      parts.push(
        `${label} ${where(r.startContainer)}:${r.startOffset}-${where(r.endContainer)}:${r.endOffset}`,
      );
    }
  };
  const pushStates = () => {
    const selectors = [...STATE_SELECTORS, ...customStates].filter((selector) => {
      try {
        document.documentElement.matches(selector);
        return true;
      } catch {
        return false;
      }
    });
    const any = selectors.join(",");
    if (any === "") return;
    elements.forEach((el, i) => {
      if (!el.matches(any)) return;
      parts.push(`@state ${i} ${selectors.filter((selector) => el.matches(selector)).join(" ")}`);
    });
  };
  const pushSelection = () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const ranges: AbstractRange[] = [];
    for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
    const direction = (selection as { direction?: string }).direction ?? "";
    parts.push(`@selection ${selection.type} ${direction}`);
    pushRanges("@range", ranges);
  };
  type Highlights = Map<string, Set<AbstractRange> & { priority?: number; type?: string }>;
  const pushHighlights = () => {
    const highlights = (window.CSS as { highlights?: Highlights } | undefined)?.highlights;
    for (const [name, highlight] of highlights ?? []) {
      parts.push(`@highlight ${name} ${highlight.priority ?? ""} ${highlight.type ?? ""}`);
      pushRanges("@range", highlight);
    }
  };
  const pushPaintState = () => {
    pushStates();
    pushSelection();
    pushHighlights();
    parts.push(`@document ${document.designMode} ${JSON.stringify(location.hash)}`);
  };

  visit(document.documentElement);
  for (const sheet of Array.from(document.styleSheets)) pushSheet(sheet);
  for (const sheet of document.adoptedStyleSheets ?? []) pushSheet(sheet);
  parts.push(
    `@window ${window.scrollX},${window.scrollY},${window.innerWidth}x${window.innerHeight}`,
  );
  parts.push(`@fonts ${document.fonts?.status ?? ""},${document.fonts?.size ?? ""}`);
  pushPaintState();
  pushAnimations(document);

  // Non-CSS values GSAP tweens write on their targets (`scrollTop`, a form value): CSS ones land in
  // the style attribute. The browser's own properties only: an expando the page added is invisible
  // here, and paints only through page code, which the page code watch counts.
  for (let i = 0; i + 1 < targets.length; i += 2) {
    const target = targets[i] as Element;
    for (const key of targets[i + 1] as string[]) {
      if (!(key in target)) continue;
      const value = (target as unknown as Record<string, unknown>)[key];
      const type = typeof value;
      if (type === "number" || type === "string" || type === "boolean") {
        parts.push(`@tween ${key}=${String(value)}`);
      }
    }
  }
  return parts.join("\n");
}

/**
 * The stacking the capture groups layers from, without the passthrough
 * video's own entry (its box and replacement-frame visibility follow the
 * video, not the overlay).
 */
export function stackingFingerprint(stacking: ElementStackingInfo[], videoId: string): string {
  return JSON.stringify(stacking.filter((entry) => entry.id !== videoId));
}

/**
 * Combine the page and stacking fingerprints into one key: equal keys mean
 * the overlay renders the same pixels.
 */
export function overlayFingerprintKey(page: string, stacking: string): string {
  return createHash("sha256").update(page).update("\0").update(stacking).digest("hex");
}

type Page = CaptureSession["page"];

/** Per overlay page: the isolated world's handle on the GSAP targets the fingerprint reads. */
const targetHandles = new WeakMap<Page, Promise<string | undefined>>();

/**
 * The elements GSAP tweens write, with their tweens' keys, as the
 * fingerprint reads them (`seekReachable.ts` finds them). Call again
 * whenever the targets are read anew; `readOverlayFingerprint` uses the
 * latest.
 */
export function setFingerprintTargets(page: Page, targets: readonly ElementTarget[]): void {
  const handle = (async () => {
    if (targets.length === 0) return undefined;
    const adopted = await adoptElements(
      page,
      targets.map((target) => target.objectId),
    );
    const args: IsolatedArg[] = [];
    targets.forEach((target, i) => {
      const objectId = adopted[i];
      if (!objectId) throw new Error("hdrPassthrough: a GSAP target is not in the document");
      args.push({ objectId }, { value: target.keys });
    });
    return handleIsolated(page, (...pairs: unknown[]) => pairs, args as never);
  })();
  handle.catch(() => undefined);
  targetHandles.set(page, handle);
}

/**
 * Fingerprint of the overlay at the page's current time. Call after the
 * seek, frame injection and stacking query of the frame, before any mask.
 * Runs in the isolated world; the text is hashed here.
 */
export async function readOverlayFingerprint(
  session: CaptureSession,
  videoId: string,
  stacking: ElementStackingInfo[],
): Promise<string> {
  const targets = await targetHandles.get(session.page);
  const text = await callIsolated<string>(
    session.page,
    collectOverlayPageFingerprint as (...args: never[]) => string,
    [
      { value: videoId },
      { value: MEDIA_RENDER_ID_ATTR },
      targets ? { objectId: targets } : { value: [] },
    ],
  );
  if (typeof text !== "string") throw new Error("hdrPassthrough: the fingerprint returned no text");
  return overlayFingerprintKey(text, stackingFingerprint(stacking, videoId));
}

/** The part of a `DOMSnapshot.captureSnapshot` result `findBlindSpotsInSnapshot` reads. */
export interface DomSnapshotLike {
  documents: Array<{
    nodes: {
      parentIndex?: number[];
      nodeName?: number[];
      /** Set on every node inside a shadow tree, to that tree's type. */
      shadowRootType?: { index: number[]; value: number[] };
      /** Per node, `[name, value, name, value, ...]` string indices. */
      attributes?: number[][];
    };
  }>;
  strings: string[];
}

/** Elements whose content is another document, which page script may not be able to read. */
const EMBEDDING_ELEMENTS: ReadonlySet<string> = new Set([
  "iframe",
  "frame",
  "object",
  "embed",
  "portal",
  "fencedframe",
]);

type SnapshotNodes = DomSnapshotLike["documents"][number]["nodes"];

/**
 * Closed shadow roots in one snapshot document. The snapshot flattens a
 * shadow tree into its host and marks each node in it with the tree's type,
 * so this counts the hosts of closed-tree nodes.
 */
function closedShadowHosts(nodes: SnapshotNodes, strings: readonly string[]): number {
  const types = nodes.shadowRootType ?? { index: [], value: [] };
  const inClosedTree = new Set<number>();
  types.index.forEach((node, i) => {
    if (strings[types.value[i] ?? -1] === "closed") inClosedTree.add(node);
  });
  const hosts = new Set<number>();
  for (const node of inClosedTree) {
    const parent = nodes.parentIndex?.[node] ?? -1;
    if (!inClosedTree.has(parent)) hosts.add(parent);
  }
  return Math.max(hosts.size, inClosedTree.size > 0 ? 1 : 0);
}

/**
 * What in a DOM snapshot the overlay fingerprint cannot read, or `null`:
 * closed shadow roots with content (user-agent ones are the browser's own
 * controls; an empty one paints nothing a change could show) and elements
 * that embed another document, wherever they sit, shadow trees included. A
 * snapshot with more than one document has content documents too. Every
 * `<object>` / `<embed>` counts, whatever it shows: what it loads is not in
 * the fingerprint either.
 */
export function findBlindSpotsInSnapshot(snapshot: DomSnapshotLike): string | null {
  const { strings } = snapshot;
  let closed = 0;
  const embedding = new Map<string, number>();
  for (const { nodes } of snapshot.documents) {
    closed += closedShadowHosts(nodes, strings);
    for (const name of nodes.nodeName ?? []) {
      const tag = (strings[name] ?? "").toLowerCase();
      if (EMBEDDING_ELEMENTS.has(tag)) embedding.set(tag, (embedding.get(tag) ?? 0) + 1);
    }
  }
  const found = [...embedding].map(([tag, count]) => `${count} <${tag}>`);
  if (closed > 0) found.unshift(`${closed} closed shadow root(s)`);
  if (embedding.size === 0 && snapshot.documents.length > 1) {
    found.push(`${snapshot.documents.length - 1} embedded document(s)`);
  }
  return found.length > 0 ? found.join(", ") : null;
}

/**
 * Content in a DOM snapshot that paints on its own clock or from state the
 * runtime drives, which no fingerprint reads, or `null`: any `<video>`
 * besides the passthrough source (one in a shadow tree or added by script
 * is not in the composition's video list), an `<audio controls>` (the
 * runtime sets every audio element's `currentTime` on a seek, and the
 * controls paint it), a `<marquee>` and an indeterminate `<progress>` (both
 * animate inside user-agent shadow trees). The snapshot pierces every
 * shadow tree, user-agent ones included.
 */
export function findOwnClockElementsInSnapshot(
  snapshot: DomSnapshotLike,
  videoId: string,
): { reason: "video_count" | "overlay_non_gsap_animation"; detail: string } | null {
  const { strings } = snapshot;
  let sources = 0;
  let otherVideos = 0;
  const counts = new Map<string, number>();
  for (const { nodes } of snapshot.documents) {
    (nodes.nodeName ?? []).forEach((name, i) => {
      const tag = (strings[name] ?? "").toLowerCase();
      if (!OWN_CLOCK_TAGS.has(tag)) return;
      const attrs = attributesOf(nodes, i, strings);
      if (tag === "video") {
        if (attrs.get("id") === videoId && sources === 0) sources++;
        else otherVideos++;
        return;
      }
      const what = ownClockElement(tag, attrs);
      if (what) counts.set(what, (counts.get(what) ?? 0) + 1);
    });
  }
  if (otherVideos > 0 || sources === 0) {
    const detail =
      sources === 0
        ? "the source video is not in the page"
        : `${otherVideos} <video> besides the source`;
    return { reason: "video_count", detail };
  }
  if (counts.size === 0) return null;
  return {
    reason: "overlay_non_gsap_animation",
    detail: [...counts].map(([what, n]) => `${n} ${what}`).join(", "),
  };
}

const OWN_CLOCK_TAGS: ReadonlySet<string> = new Set(["video", "audio", "marquee", "progress"]);

/** One snapshot node's attributes, by lower-case name. */
function attributesOf(
  nodes: SnapshotNodes,
  index: number,
  strings: readonly string[],
): Map<string, string> {
  const pairs = nodes.attributes?.[index] ?? [];
  const attrs = new Map<string, string>();
  for (let a = 0; a + 1 < pairs.length; a += 2) {
    attrs.set(
      (strings[pairs[a] as number] ?? "").toLowerCase(),
      strings[pairs[a + 1] as number] ?? "",
    );
  }
  return attrs;
}

/** What an `<audio>`, `<marquee>` or `<progress>` that paints on its own is, or `null`. */
function ownClockElement(tag: string, attrs: ReadonlyMap<string, string>): string | null {
  if (tag === "audio") return attrs.has("controls") ? "<audio controls>" : null;
  if (tag === "marquee") return "<marquee>";
  return attrs.has("value") ? null : "indeterminate <progress>";
}

export async function captureDomSnapshot(page: CaptureSession["page"]): Promise<DomSnapshotLike> {
  const client = await getCdpSession(page);
  return client.send("DOMSnapshot.captureSnapshot", { computedStyles: [] });
}
