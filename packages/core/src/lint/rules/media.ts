import type { LintContext, HyperframeLintFinding } from "../context";
import { readAttr, truncateSnippet, isMediaTag } from "../utils";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAttrName(tagSource: string, attr: string): boolean {
  const escaped = escapeRegExp(attr);
  const attrs = tagSource.replace(/^<\s*[a-z][\w:-]*/i, "");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s*=|\\s|/?>)`, "i").test(attrs);
}

function classNamesFromAttr(classAttr: string | null): string[] {
  if (!classAttr) return [];
  return classAttr.split(/\s+/).filter(Boolean);
}

type MediaSelectorIndex = {
  ids: Set<string>;
  classes: Set<string>;
  hasVideo: boolean;
  hasAudio: boolean;
};

function selectorTargetsManagedMedia(selector: string, mediaIndex: MediaSelectorIndex): boolean {
  const normalized = selector.trim();
  if (!normalized) return false;
  if (mediaIndex.hasVideo && /\bvideo\b/i.test(normalized)) return true;
  if (mediaIndex.hasAudio && /\baudio\b/i.test(normalized)) return true;
  for (const mediaId of mediaIndex.ids) {
    const escapedId = escapeRegExp(mediaId);
    if (
      new RegExp(`#${escapedId}(?![\\w-])`).test(normalized) ||
      normalized.includes(`[id="${mediaId}"]`) ||
      normalized.includes(`[id='${mediaId}']`)
    ) {
      return true;
    }
  }
  for (const className of mediaIndex.classes) {
    if (new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`).test(normalized)) {
      return true;
    }
  }
  return false;
}

function findImperativeMediaControlFindings(ctx: LintContext): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  const mediaTags = ctx.tags.filter((tag) => tag.name === "video" || tag.name === "audio");
  const mediaIndex: MediaSelectorIndex = {
    ids: new Set(
      mediaTags.map((tag) => readAttr(tag.raw, "id")).filter((id): id is string => Boolean(id)),
    ),
    classes: new Set(mediaTags.flatMap((tag) => classNamesFromAttr(readAttr(tag.raw, "class")))),
    hasVideo: mediaTags.some((tag) => tag.name === "video"),
    hasAudio: mediaTags.some((tag) => tag.name === "audio"),
  };

  if (mediaTags.length === 0 || ctx.scripts.length === 0) return findings;

  for (const script of ctx.scripts) {
    const mediaVars = new Map<string, string | undefined>();
    const assignmentPatterns = [
      {
        pattern:
          /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:document|window\.document)\.getElementById\(\s*["']([^"']+)["']\s*\)/g,
        variableIndex: 1,
        targetIndex: 2,
      },
      {
        pattern:
          /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:document|window\.document)\.querySelector\(\s*(["'])([\s\S]*?)\2\s*\)/g,
        variableIndex: 1,
        targetIndex: 3,
      },
    ];

    for (const { pattern, variableIndex, targetIndex } of assignmentPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(script.content)) !== null) {
        const variableName = match[variableIndex];
        const target = match[targetIndex];
        if (!variableName || !target) continue;
        if (mediaIndex.ids.has(target) || selectorTargetsManagedMedia(target, mediaIndex)) {
          mediaVars.set(variableName, mediaIndex.ids.has(target) ? target : undefined);
        }
      }
    }

    const directIdPatterns = [
      {
        pattern:
          /\b(?:document|window\.document)\.getElementById\(\s*["']([^"']+)["']\s*\)\.play\s*\(/g,
        kind: "play()",
        targetIndex: 1,
      },
      {
        pattern:
          /\b(?:document|window\.document)\.getElementById\(\s*["']([^"']+)["']\s*\)\.pause\s*\(/g,
        kind: "pause()",
        targetIndex: 1,
      },
      {
        pattern:
          /\b(?:document|window\.document)\.getElementById\(\s*["']([^"']+)["']\s*\)\.currentTime\s*=/g,
        kind: "currentTime",
        targetIndex: 1,
      },
      {
        pattern:
          /\b(?:document|window\.document)\.getElementById\(\s*["']([^"']+)["']\s*\)\.muted\s*=/g,
        kind: "muted assignment",
        targetIndex: 1,
      },
      {
        pattern:
          /\b(?:document|window\.document)\.querySelector\(\s*(["'])([\s\S]*?)\1\s*\)\.play\s*\(/g,
        kind: "play()",
        targetIndex: 2,
      },
      {
        pattern:
          /\b(?:document|window\.document)\.querySelector\(\s*(["'])([\s\S]*?)\1\s*\)\.pause\s*\(/g,
        kind: "pause()",
        targetIndex: 2,
      },
      {
        pattern:
          /\b(?:document|window\.document)\.querySelector\(\s*(["'])([\s\S]*?)\1\s*\)\.currentTime\s*=/g,
        kind: "currentTime",
        targetIndex: 2,
      },
      {
        pattern:
          /\b(?:document|window\.document)\.querySelector\(\s*(["'])([\s\S]*?)\1\s*\)\.muted\s*=/g,
        kind: "muted assignment",
        targetIndex: 2,
      },
    ];

    for (const { pattern, kind, targetIndex } of directIdPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(script.content)) !== null) {
        const target = match[targetIndex];
        if (!target) continue;
        const elementId = mediaIndex.ids.has(target)
          ? target
          : selectorTargetsManagedMedia(target, mediaIndex)
            ? undefined
            : null;
        if (elementId === null) continue;
        findings.push({
          code: "imperative_media_control",
          severity: "error",
          message: `Inline <script> imperatively controls managed media via ${kind}. HyperFrames must own media play/pause/seek to keep preview, timeline, and renders deterministic.`,
          elementId: elementId || undefined,
          fixHint:
            "Remove imperative media play/pause/currentTime/muted control. Express timing with data-start/data-duration and media offsets like data-media-start or data-playback-start instead.",
          snippet: truncateSnippet(match[0]),
        });
      }
    }

    for (const [variableName, elementId] of mediaVars) {
      const escapedVar = escapeRegExp(variableName);
      const variablePatterns = [
        { pattern: new RegExp(`\\b${escapedVar}\\.play\\s*\\(`, "g"), kind: "play()" },
        { pattern: new RegExp(`\\b${escapedVar}\\.pause\\s*\\(`, "g"), kind: "pause()" },
        { pattern: new RegExp(`\\b${escapedVar}\\.currentTime\\s*=`, "g"), kind: "currentTime" },
        {
          pattern: new RegExp(`\\b${escapedVar}\\.muted\\s*=`, "g"),
          kind: "muted assignment",
        },
      ];
      for (const { pattern, kind } of variablePatterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(script.content)) !== null) {
          findings.push({
            code: "imperative_media_control",
            severity: "error",
            message: `Inline <script> imperatively controls managed media via ${kind}. HyperFrames must own media play/pause/seek to keep preview, timeline, and renders deterministic.`,
            elementId,
            fixHint:
              "Remove imperative media play/pause/currentTime/muted control. Express timing with data-start/data-duration and media offsets like data-media-start or data-playback-start instead.",
            snippet: truncateSnippet(match[0]),
          });
        }
      }
    }
  }

  return findings;
}

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
      const hasMuted = hasAttrName(tag.raw, "muted");
      const hasDeclaredAudio = readAttr(tag.raw, "data-has-audio") === "true";
      if (!hasMuted && !hasDeclaredAudio && readAttr(tag.raw, "data-start")) {
        const elementId = readAttr(tag.raw, "id") || undefined;
        findings.push({
          code: "video_missing_muted",
          severity: "error",
          message: `<video${elementId ? ` id="${elementId}"` : ""}> has data-start but is not muted. Mark audible videos with data-has-audio="true"; otherwise keep video muted and use a separate <audio> element for sound.`,
          elementId,
          fixHint:
            'Add the `muted` attribute for silent video, or add data-has-audio="true" when the video track should contribute audio.',
          snippet: truncateSnippet(tag.raw),
        });
      }
      if (hasMuted && hasDeclaredAudio) {
        const elementId = readAttr(tag.raw, "id") || undefined;
        findings.push({
          code: "video_muted_with_declared_audio",
          severity: "error",
          message: `<video${elementId ? ` id="${elementId}"` : ""}> declares data-has-audio="true" but also has muted. Studio preview will silence the video audio.`,
          elementId,
          fixHint:
            'Remove the `muted` attribute if this video should be audible, or remove data-has-audio="true" and use data-volume="0" for silent visual video.',
          snippet: truncateSnippet(tag.raw),
        });
      }
    }
    return findings;
  },

  // video_nested_in_timed_element
  ({ source, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    // HTML5 void elements cannot contain children, so they can never be a
    // parent of a nested <video>. Skipping them avoids false positives where
    // the linter looks for `</img>` and never finds it.
    const voidElements = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "source",
      "track",
      "wbr",
    ]);
    const timedTagPositions: Array<{ name: string; start: number; id?: string }> = [];
    for (const tag of tags) {
      if (tag.name === "video" || tag.name === "audio") continue;
      if (voidElements.has(tag.name)) continue;
      // Skip the composition root — it uses data-start as a playback anchor, not as a clip timer
      if (readAttr(tag.raw, "data-composition-id")) continue;
      if (readAttr(tag.raw, "data-start")) {
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

  // media_missing_data_start + media_missing_id + media_missing_src + media_preload_none
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      if (tag.name !== "video" && tag.name !== "audio") continue;
      const hasDataStart = readAttr(tag.raw, "data-start");
      const hasId = readAttr(tag.raw, "id");
      const hasSrc = readAttr(tag.raw, "src");
      if (hasSrc && !hasDataStart) {
        findings.push({
          code: "media_missing_data_start",
          severity: "error",
          message: `<${tag.name}${hasId ? ` id="${hasId}"` : ""}> has src but no data-start. HyperFrames cannot own playback for untimed media, so preview and render behavior can diverge.`,
          elementId: hasId || undefined,
          fixHint: `Add data-start="0" (or the intended start time) and data-duration if the clip should stop before the source ends.`,
          snippet: truncateSnippet(tag.raw),
        });
      }
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

  // video_audio_double_source — catches audible <video> paired with a separate
  // <audio> pointing to the same file, which causes double playback at runtime
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const videoSources = new Map<string, { id?: string; raw: string }>();
    const audioSources = new Map<string, { id?: string; raw: string }>();

    for (const tag of tags) {
      if (!readAttr(tag.raw, "data-start")) continue;
      const src = readAttr(tag.raw, "src");
      if (!src) continue;
      const elementId = readAttr(tag.raw, "id") || undefined;
      if (tag.name === "video") {
        const isMuted = hasAttrName(tag.raw, "muted");
        if (!isMuted) {
          videoSources.set(src, { id: elementId, raw: tag.raw });
        }
      } else if (tag.name === "audio") {
        audioSources.set(src, { id: elementId, raw: tag.raw });
      }
    }

    for (const [src, audioInfo] of audioSources) {
      const videoInfo = videoSources.get(src);
      if (!videoInfo) continue;
      findings.push({
        code: "video_audio_double_source",
        severity: "error",
        message: `<audio${audioInfo.id ? ` id="${audioInfo.id}"` : ""}> and <video${videoInfo.id ? ` id="${videoInfo.id}"` : ""}> both point to the same source. The unmuted video already provides audio — the duplicate <audio> will cause double playback and echo.`,
        elementId: audioInfo.id,
        fixHint:
          "Either mute the video (add `muted` attribute) and keep the separate <audio>, or remove the <audio> element and let the video provide its own audio track.",
        snippet: truncateSnippet(audioInfo.raw),
      });
    }
    return findings;
  },

  // imperative_media_control
  findImperativeMediaControlFindings,
];
