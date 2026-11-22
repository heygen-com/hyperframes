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
 *   - the CSSOM of every stylesheet, which `insertRule` can change without
 *     touching the DOM;
 *   - state the DOM does not reflect: element and window scroll, form values,
 *     image load state, font loading status;
 *   - every CSS / Web Animation's play state and current time (a transition
 *     or animation started by a class change differs on every frame, so it
 *     never merges);
 *   - the current value of every non-CSS property a GSAP tween writes on its
 *     target (`scrollTop`, a custom element's property, a plain object);
 *   - the element stacking the layered compositor groups layers from.
 *
 * The passthrough video and its injected replacement frame are left out:
 * their per-frame changes are the video, not the overlay, and the capture
 * masks them. Anything unaccounted for can only make two equal overlays look
 * different (an extra capture), never two different ones look equal, as
 * long as it is in this list.
 */

import { createHash } from "node:crypto";
import type { CaptureSession, ElementStackingInfo } from "@hyperframes/engine";

/** What the in-page collector returns: a sha256 when the page can hash, else the text. */
export type PageFingerprint = { kind: "digest"; value: string } | { kind: "text"; value: string };

/**
 * Runs in the page; must stay self-contained (serialized by `page.evaluate`).
 * Read-only: never seeks, never writes the DOM.
 */
// fallow-ignore-next-line complexity
export async function collectOverlayPageFingerprint(videoId: string): Promise<PageFingerprint> {
  const w = window as unknown as {
    __hfMediaEl?: (id: string) => Element | null;
    __timelines?: Record<string, unknown>;
  };
  const parts: string[] = [];
  const skipped = new Set<Node>();
  const video = w.__hfMediaEl?.(videoId) ?? document.getElementById(videoId);
  if (video) skipped.add(video);
  for (const img of Array.from(document.querySelectorAll(".__render_frame__"))) skipped.add(img);

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
      parts.push(JSON.stringify((node as CharacterData).data));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
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
    } else if (el instanceof HTMLTextAreaElement) {
      parts.push(` @value=${JSON.stringify(el.value)}`);
    } else if (el instanceof HTMLSelectElement) {
      parts.push(` @selected=${el.selectedIndex}`);
    } else if (el instanceof HTMLImageElement) {
      parts.push(` @img=${el.complete},${el.naturalWidth}x${el.naturalHeight},${el.currentSrc}`);
    }
    parts.push(">");
    const shadow = el.shadowRoot;
    if (shadow) {
      parts.push("<#shadow>");
      visitChildren(shadow);
      for (const sheet of shadow.adoptedStyleSheets ?? []) pushSheet(sheet);
      parts.push("</#shadow>");
    }
    // Script and noscript text never paints (scripts already ran; scripting is on). The
    // runtime's own script alone is megabytes, which this probe would otherwise hash every frame.
    if (el.localName !== "script" && el.localName !== "noscript") visitChildren(el);
    parts.push("</>");
  };
  const pushSheet = (sheet: CSSStyleSheet) => {
    parts.push(`@sheet ${sheet.disabled ? "off" : "on"} ${sheet.media?.mediaText ?? ""}`);
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText);
    } catch {
      // A cross-origin sheet cannot change without its <link> changing, which the DOM walk sees.
      parts.push(`@opaque ${sheet.href ?? ""}`);
    }
  };

  visit(document.documentElement);
  for (const sheet of Array.from(document.styleSheets)) pushSheet(sheet);
  for (const sheet of document.adoptedStyleSheets ?? []) pushSheet(sheet);
  parts.push(
    `@window ${window.scrollX},${window.scrollY},${window.innerWidth}x${window.innerHeight}`,
  );
  parts.push(`@fonts ${document.fonts?.status ?? ""},${document.fonts?.size ?? ""}`);
  try {
    for (const animation of document.getAnimations()) {
      parts.push(`@anim ${animation.playState},${String(animation.currentTime)}`);
    }
  } catch {
    // Unreadable animations cannot be proven equal: make this probe unique.
    parts.push(`@anim unreadable ${Math.random()}`);
  }

  // Non-CSS values GSAP tweens write on their targets: CSS ones land in the style attribute.
  type Tweenish = {
    targets?: () => unknown[];
    vars?: Record<string, unknown>;
    getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => Tweenish[];
    __hfReal?: Tweenish;
  };
  const seen = new Set<unknown>();
  for (const entry of Object.values(w.__timelines ?? {})) {
    const tl = ((entry as Tweenish | undefined)?.__hfReal ?? entry) as Tweenish | undefined;
    if (!tl || typeof tl.getChildren !== "function" || seen.has(tl)) continue;
    seen.add(tl);
    for (const tween of tl.getChildren(true, true, false)) {
      const targets = typeof tween.targets === "function" ? tween.targets() : [];
      const keys = Object.keys(tween.vars ?? {});
      for (const target of targets) {
        if (!target || typeof target !== "object") continue;
        for (const key of keys) {
          if (!(key in target)) continue;
          const value = (target as Record<string, unknown>)[key];
          const type = typeof value;
          if (type === "number" || type === "string" || type === "boolean") {
            parts.push(`@tween ${key}=${String(value)}`);
          }
        }
      }
    }
  }

  const text = parts.join("\n");
  const subtle = window.isSecureContext ? window.crypto?.subtle : undefined;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"));
    return { kind: "digest", value: hex.join("") };
  }
  return { kind: "text", value: text };
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
 * the overlay renders the same pixels. The page part's kind is part of the
 * key, so a digest never compares equal to a text.
 */
export function overlayFingerprintKey(page: PageFingerprint, stacking: string): string {
  return createHash("sha256")
    .update(page.kind)
    .update("\0")
    .update(page.value)
    .update("\0")
    .update(stacking)
    .digest("hex");
}

/**
 * Fingerprint of the overlay at the page's current time. Call after the
 * seek, frame injection and stacking query of the frame, before any mask.
 */
export async function readOverlayFingerprint(
  session: CaptureSession,
  videoId: string,
  stacking: ElementStackingInfo[],
): Promise<string> {
  const page = await session.page.evaluate(collectOverlayPageFingerprint, videoId);
  return overlayFingerprintKey(page, stackingFingerprint(stacking, videoId));
}
