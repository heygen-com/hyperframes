/**
 * Producer-local timing compiler helpers.
 * Keep this aligned with core timing compiler behavior.
 */

export interface UnresolvedElement {
  id: string;
  tagName: string;
  src?: string;
  start: number;
  end?: number;
  duration?: number;
  mediaStart: number;
  compositionSrc?: string;
}

export interface ResolvedDuration {
  id: string;
  duration: number;
}

export interface ResolvedMediaElement {
  id: string;
  tagName: string;
  src?: string;
  start: number;
  duration: number;
  mediaStart: number;
}

export interface CompilationResult {
  html: string;
  unresolved: UnresolvedElement[];
}

function getAttr(tag: string, attr: string): string | null {
  const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`));
  return match ? (match[1] ?? null) : null;
}

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`${attr}=["']`).test(tag);
}

function injectAttr(tag: string, attr: string, value: string): string {
  return tag.replace(/>$/, ` ${attr}="${value}">`);
}

function compileTag(
  tag: string,
  isVideo: boolean,
): { tag: string; unresolved: UnresolvedElement | null } {
  let result = tag;
  let unresolved: UnresolvedElement | null = null;
  const id = getAttr(result, "id");
  const startStr = getAttr(result, "data-start");
  const start = startStr !== null ? parseFloat(startStr) : 0;
  const mediaStartStr = getAttr(result, "data-media-start");
  const mediaStart = mediaStartStr ? parseFloat(mediaStartStr) : 0;

  if (!hasAttr(result, "data-end")) {
    const durationStr = getAttr(result, "data-duration");
    if (durationStr !== null) {
      result = injectAttr(result, "data-end", String(start + parseFloat(durationStr)));
    } else if (id) {
      unresolved = {
        id,
        tagName: isVideo ? "video" : "audio",
        src: getAttr(result, "src") ?? undefined,
        start,
        mediaStart,
      };
    }
  }

  if (isVideo && !hasAttr(result, "data-has-audio")) {
    result = injectAttr(result, "data-has-audio", "true");
  }

  return { tag: result, unresolved };
}

export function compileTimingAttrs(html: string): CompilationResult {
  const unresolved: UnresolvedElement[] = [];

  html = html.replace(/<video[^>]*>/gi, (match) => {
    const { tag, unresolved: u } = compileTag(match, true);
    if (u) {
      unresolved.push(u);
    }
    return tag;
  });

  html = html.replace(/<audio[^>]*>/gi, (match) => {
    const { tag, unresolved: u } = compileTag(match, false);
    if (u) {
      unresolved.push(u);
    }
    return tag;
  });

  html.replace(/<(?:div|section)[^>]*>/gi, (match) => {
    if (!hasAttr(match, "data-start")) {
      return match;
    }
    if (hasAttr(match, "data-end") || hasAttr(match, "data-duration")) {
      return match;
    }
    const id = getAttr(match, "id");
    if (id) {
      const startStr = getAttr(match, "data-start");
      const compositionSrc = getAttr(match, "data-composition-src");
      unresolved.push({
        id,
        tagName: "div",
        start: startStr ? parseFloat(startStr) : 0,
        mediaStart: 0,
        compositionSrc: compositionSrc ?? undefined,
      });
    }
    return match;
  });

  return { html, unresolved };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function injectDurations(html: string, resolutions: ResolvedDuration[]): string {
  for (const { id, duration } of resolutions) {
    const idPattern = new RegExp(`(<[^>]*id=["']${escapeRegex(id)}["'][^>]*>)`, "gi");
    html = html.replace(idPattern, (tag) => {
      let result = tag;
      if (!hasAttr(result, "data-duration")) {
        result = injectAttr(result, "data-duration", String(duration));
      }
      if (!hasAttr(result, "data-end")) {
        const startStr = getAttr(result, "data-start");
        const start = startStr ? parseFloat(startStr) : 0;
        result = injectAttr(result, "data-end", String(start + duration));
      }
      return result;
    });
  }
  return html;
}

/**
 * Extract video/audio elements that already have data-duration set.
 * Used by callers to validate declared durations against actual source durations.
 */
export function extractResolvedMedia(html: string): ResolvedMediaElement[] {
  const resolved: ResolvedMediaElement[] = [];

  const mediaRegex = /<(?:video|audio)[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = mediaRegex.exec(html)) !== null) {
    const tag = match[0];
    const id = getAttr(tag, "id");
    const durationStr = getAttr(tag, "data-duration");
    if (!id || durationStr === null) continue;

    const duration = parseFloat(durationStr);
    if (!Number.isFinite(duration) || duration <= 0) continue;

    const isVideo = /^<video/i.test(tag);
    const startStr = getAttr(tag, "data-start");
    const mediaStartStr = getAttr(tag, "data-media-start");

    resolved.push({
      id,
      tagName: isVideo ? "video" : "audio",
      src: getAttr(tag, "src") ?? undefined,
      start: startStr !== null ? parseFloat(startStr) : 0,
      duration,
      mediaStart: mediaStartStr ? parseFloat(mediaStartStr) : 0,
    });
  }

  return resolved;
}

/**
 * Clamp existing data-duration and data-end on media elements.
 * For each resolution, replaces the declared duration with the clamped value
 * and recomputes data-end accordingly.
 */
export function clampDurations(html: string, clamps: ResolvedDuration[]): string {
  for (const { id, duration } of clamps) {
    const idPattern = new RegExp(`(<[^>]*id=["']${escapeRegex(id)}["'][^>]*>)`, "gi");

    html = html.replace(idPattern, (tag) => {
      // Replace data-duration value
      tag = tag.replace(/data-duration=["'][^"']*["']/, `data-duration="${duration}"`);

      // Recompute data-end from data-start + clamped duration
      const startStr = getAttr(tag, "data-start");
      const start = startStr ? parseFloat(startStr) : 0;
      tag = tag.replace(/data-end=["'][^"']*["']/, `data-end="${start + duration}"`);

      return tag;
    });
  }

  return html;
}
