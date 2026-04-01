import type { LintContext, HyperframeLintFinding } from "../context";
import { readAttr, truncateSnippet, isMediaTag } from "../utils";

export const mediaRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // duplicate_media_id + duplicate_media_discovery_risk
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const mediaById = new Map<string, typeof tags>();
    const mediaFingerprintCounts = new Map<string, number>();

    for (const tag of tags) {
      if (!isMediaTag(tag.name)) continue;
      const elementId = readAttr(tag.raw, "id");
      if (elementId) {
        const existing = mediaById.get(elementId) || [];
        existing.push(tag);
        mediaById.set(elementId, existing);
      }
      const fingerprint = [
        tag.name,
        readAttr(tag.raw, "src") || "",
        readAttr(tag.raw, "data-start") || "",
        readAttr(tag.raw, "data-duration") || "",
      ].join("|");
      mediaFingerprintCounts.set(fingerprint, (mediaFingerprintCounts.get(fingerprint) || 0) + 1);
    }

    for (const [elementId, mediaTags] of mediaById) {
      if (mediaTags.length < 2) continue;
      findings.push({
        code: "duplicate_media_id",
        severity: "error",
        message: `Media id "${elementId}" is defined multiple times.`,
        elementId,
        fixHint:
          "Give each media element a unique id so preview and producer discover the same media graph.",
        snippet: truncateSnippet(mediaTags[0]?.raw || ""),
      });
    }

    for (const [fingerprint, count] of mediaFingerprintCounts) {
      if (count < 2) continue;
      const [tagName, src, dataStart, dataDuration] = fingerprint.split("|");
      findings.push({
        code: "duplicate_media_discovery_risk",
        severity: "warning",
        message: `Detected ${count} matching ${tagName} entries with the same source/start/duration.`,
        fixHint: "Avoid duplicated media nodes that can be discovered twice during compilation.",
        snippet: truncateSnippet(
          `${tagName} src=${src} data-start=${dataStart} data-duration=${dataDuration}`,
        ),
      });
    }
    return findings;
  },

  // video_missing_muted
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      if (tag.name !== "video") continue;
      const hasMuted = /\bmuted\b/i.test(tag.raw);
      if (!hasMuted && readAttr(tag.raw, "data-start")) {
        const elementId = readAttr(tag.raw, "id") || undefined;
        findings.push({
          code: "video_missing_muted",
          severity: "error",
          message: `<video${elementId ? ` id="${elementId}"` : ""}> has data-start but is not muted. The framework expects video to be muted with a separate <audio> element for sound.`,
          elementId,
          fixHint:
            "Add the `muted` attribute to the <video> tag and use a separate <audio> element with the same src for audio playback.",
          snippet: truncateSnippet(tag.raw),
        });
      }
    }
    return findings;
  },

  // video_nested_in_timed_element
  ({ source, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const timedTagPositions: Array<{ name: string; start: number; id?: string }> = [];
    for (const tag of tags) {
      if (tag.name === "video" || tag.name === "audio") continue;
      if (readAttr(tag.raw, "data-start") && !readAttr(tag.raw, "data-composition-id")) {
        timedTagPositions.push({
          name: tag.name,
          start: tag.index,
          id: readAttr(tag.raw, "id") || undefined,
        });
      }
    }
    for (const tag of tags) {
      if (tag.name !== "video") continue;
      if (!readAttr(tag.raw, "data-start")) continue;
      for (const parent of timedTagPositions) {
        if (parent.start < tag.index) {
          const parentClosePattern = new RegExp(`</${parent.name}>`, "gi");
          const between = source.substring(parent.start, tag.index);
          if (!parentClosePattern.test(between)) {
            findings.push({
              code: "video_nested_in_timed_element",
              severity: "error",
              message: `<video> with data-start is nested inside <${parent.name}${parent.id ? ` id="${parent.id}"` : ""}> which also has data-start. The framework cannot manage playback of nested media — video will be FROZEN in renders.`,
              elementId: readAttr(tag.raw, "id") || undefined,
              fixHint:
                "Move the <video> to be a direct child of the stage, or remove data-start from the wrapper div (use it as a non-timed visual container).",
              snippet: truncateSnippet(tag.raw),
            });
            break;
          }
        }
      }
    }
    return findings;
  },

  // self_closing_media_tag
  ({ source }) => {
    const findings: HyperframeLintFinding[] = [];
    const selfClosingMediaRe = /<(audio|video)\b[^>]*\/>/gi;
    let scMatch: RegExpExecArray | null;
    while ((scMatch = selfClosingMediaRe.exec(source)) !== null) {
      const tagName = scMatch[1] || "audio";
      const elementId = readAttr(scMatch[0], "id") || undefined;
      findings.push({
        code: "self_closing_media_tag",
        severity: "error",
        message: `Self-closing <${tagName}/> is invalid HTML. The browser will leave the tag open, swallowing all subsequent elements as invisible fallback content. This makes compositions INVISIBLE.`,
        elementId,
        fixHint: `Change <${tagName} .../> to <${tagName} ...></${tagName}> — media elements MUST have explicit closing tags.`,
        snippet: truncateSnippet(scMatch[0]),
      });
    }
    return findings;
  },

  // placeholder_media_url
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const PLACEHOLDER_DOMAINS =
      /\b(placehold\.co|placeholder\.com|placekitten\.com|picsum\.photos|example\.com|via\.placeholder\.com|dummyimage\.com)\b/i;
    for (const tag of tags) {
      if (!isMediaTag(tag.name)) continue;
      const src = readAttr(tag.raw, "src");
      if (!src) continue;
      if (PLACEHOLDER_DOMAINS.test(src)) {
        const elementId = readAttr(tag.raw, "id") || undefined;
        findings.push({
          code: "placeholder_media_url",
          severity: "error",
          message: `<${tag.name}${elementId ? ` id="${elementId}"` : ""}> uses a placeholder URL that will 404 at render time: ${src.slice(0, 80)}`,
          elementId,
          fixHint: "Replace with a real media URL. Placeholder domains will 404 at render time.",
          snippet: truncateSnippet(tag.raw),
        });
      }
    }
    return findings;
  },

  // base64_media_prohibited
  ({ source }) => {
    const findings: HyperframeLintFinding[] = [];
    const base64MediaRe =
      /src\s*=\s*["'](data:(?:audio|video)\/[^;]+;base64,([A-Za-z0-9+/=]{20,}))["']/gi;
    let b64Match: RegExpExecArray | null;
    while ((b64Match = base64MediaRe.exec(source)) !== null) {
      const sample = (b64Match[2] || "").slice(0, 200);
      const uniqueChars = new Set(sample.replace(/[A-Za-z0-9+/=]/g, (c) => c)).size;
      const dataSize = Math.round(((b64Match[2] || "").length * 3) / 4);
      const isSuspicious = uniqueChars < 15 || (dataSize > 1000 && dataSize < 50000);
      findings.push({
        code: "base64_media_prohibited",
        severity: "error",
        message: `Inline base64 audio/video detected (${(dataSize / 1024).toFixed(0)} KB)${isSuspicious ? " — likely fabricated data" : ""}. Base64 media is prohibited — it bloats file size and breaks rendering.`,
        fixHint:
          "Use a relative path (assets/music.mp3) or HTTPS URL for the audio/video src. Never embed media as base64.",
        snippet: truncateSnippet((b64Match[1] ?? "").slice(0, 80) + "..."),
      });
    }
    return findings;
  },

  // media_missing_id + media_missing_src + media_preload_none
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      if (tag.name !== "video" && tag.name !== "audio") continue;
      const hasDataStart = readAttr(tag.raw, "data-start");
      const hasId = readAttr(tag.raw, "id");
      const hasSrc = readAttr(tag.raw, "src");
      if (hasDataStart && !hasId) {
        findings.push({
          code: "media_missing_id",
          severity: "error",
          message: `<${tag.name}> has data-start but no id attribute. The renderer requires id to discover media elements — this ${tag.name === "audio" ? "audio will be SILENT" : "video will be FROZEN"} in renders.`,
          fixHint: `Add a unique id attribute: <${tag.name} id="my-${tag.name}" ...>`,
          snippet: truncateSnippet(tag.raw),
        });
      }
      if (hasDataStart && hasId && !hasSrc) {
        findings.push({
          code: "media_missing_src",
          severity: "error",
          message: `<${tag.name} id="${hasId}"> has data-start but no src attribute. The renderer cannot load this media.`,
          elementId: hasId,
          fixHint: `Add a src attribute to the <${tag.name}> element directly. If using <source> children, the renderer still requires src on the parent element.`,
          snippet: truncateSnippet(tag.raw),
        });
      }
      if (readAttr(tag.raw, "preload") === "none") {
        findings.push({
          code: "media_preload_none",
          severity: "warning",
          message: `<${tag.name}${hasId ? ` id="${hasId}"` : ""}> has preload="none" which prevents the renderer from loading this media. The compiler strips it for renders, but preview may also have issues.`,
          elementId: hasId || undefined,
          fixHint: `Remove preload="none" or change to preload="auto". The framework manages media loading.`,
          snippet: truncateSnippet(tag.raw),
        });
      }
    }
    return findings;
  },
];
