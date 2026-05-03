// Caption Parser — Extract Transcript & Build Caption Model
// Parses a caption composition's JavaScript source to extract the transcript word array,
// and builds a CaptionModel from a TranscriptWord array.

import {
  CaptionModel,
  CaptionSegment,
  CaptionGroup,
  CaptionStyle,
  CaptionContainerStyle,
  DEFAULT_STYLE,
  DEFAULT_CONTAINER,
  DEFAULT_ANIMATION_SET,
} from "./types";

export interface TranscriptWord {
  id?: string;
  text: string;
  start: number;
  end: number;
}

export interface BuildOptions {
  width: number;
  height: number;
  duration: number;
  wordsPerGroup?: number; // default 5
}

/**
 * Builds a CaptionModel from a transcript word array and composition dimensions.
 *
 * Words are grouped into chunks of `wordsPerGroup` (default 5). Each word becomes a
 * CaptionSegment with its original timing. Each chunk becomes a CaptionGroup with
 * DEFAULT_STYLE, DEFAULT_ANIMATION_SET, and DEFAULT_CONTAINER.
 */
export function buildCaptionModel(
  transcript: TranscriptWord[],
  options: BuildOptions,
): CaptionModel {
  const { width, height, duration, wordsPerGroup = 5 } = options;

  const segments = new Map<string, CaptionSegment>();
  const groups = new Map<string, CaptionGroup>();
  const groupOrder: string[] = [];

  // Chunk the transcript into groups of wordsPerGroup
  for (let groupIdx = 0; groupIdx < transcript.length; groupIdx += wordsPerGroup) {
    const chunk = transcript.slice(groupIdx, groupIdx + wordsPerGroup);
    const groupId = `group-${groupIdx / wordsPerGroup}`;
    const segmentIds: string[] = [];

    chunk.forEach((word, wordIdx) => {
      const segmentId = `segment-${groupIdx + wordIdx}`;
      const segment: CaptionSegment = {
        id: segmentId,
        wordId: word.id ?? `w${groupIdx + wordIdx}`,
        text: word.text,
        start: word.start,
        end: word.end,
        groupIndex: wordIdx,
        style: {},
        animation: {},
      };
      segments.set(segmentId, segment);
      segmentIds.push(segmentId);
    });

    const group: CaptionGroup = {
      id: groupId,
      segmentIds,
      style: { ...DEFAULT_STYLE },
      animation: {
        entrance: { ...DEFAULT_ANIMATION_SET.entrance },
        highlight: DEFAULT_ANIMATION_SET.highlight,
        exit: { ...DEFAULT_ANIMATION_SET.exit },
      },
      containerStyle: { ...DEFAULT_CONTAINER },
    };
    groups.set(groupId, group);
    groupOrder.push(groupId);
  }

  return {
    width,
    height,
    duration,
    segments,
    groups,
    groupOrder,
    defaultAnimation: {
      entrance: { ...DEFAULT_ANIMATION_SET.entrance },
      highlight: DEFAULT_ANIMATION_SET.highlight,
      exit: { ...DEFAULT_ANIMATION_SET.exit },
    },
  };
}

/**
 * Extracts a transcript word array from caption composition source code.
 *
 * Looks for `const TRANSCRIPT = [...]` or `const script = [...]` (also let/var)
 * and parses each `{ text, start, end }` object into TranscriptWord objects.
 *
 * Returns an empty array if no transcript is found or if parsing fails.
 */
export function extractTranscript(source: string): TranscriptWord[] {
  // Match: (const|let|var) (TRANSCRIPT|script) = [...]
  // The array may span multiple lines and contain trailing commas.
  // The lazy [\s\S]*? anchors on the first `];` — assumes transcript word
  // text never contains a literal `];` string (safe for speech transcripts).
  const varPattern = /(?:const|let|var)\s+(?:TRANSCRIPT|script)\s*=\s*(\[[\s\S]*?\]);/;
  const match = source.match(varPattern);

  if (!match) {
    return [];
  }

  const arrayLiteral = match[1];

  try {
    return parseTranscriptArray(arrayLiteral);
  } catch {
    return [];
  }
}

/**
 * Parses a caption composition from a live iframe DOM, extracting the transcript
 * from the source and reading computed styles from rendered elements.
 *
 * Runs in the Studio (outside the iframe). Reads computed styles from iframe DOM
 * elements to build a fully-styled CaptionModel.
 *
 * Returns null if no transcript is found in the source.
 */
export function parseCaptionComposition(
  iframeDoc: Document,
  iframeWin: Window,
  source: string,
  compositionWidth: number,
  compositionHeight: number,
  compositionDuration: number,
): CaptionModel | null {
  // Step 1: Extract transcript words from source
  const transcript = extractTranscript(source);
  if (transcript.length === 0) {
    return null;
  }

  // Step 2: Look for grouping and word elements in the iframe DOM
  const groupEls = iframeDoc.querySelectorAll(".caption-group, .caption-line, .caption-block");
  const wordEls = iframeDoc.querySelectorAll(".word, .caption-word");

  // Step 3: Infer wordsPerGroup from element counts
  let wordsPerGroup = 5; // default
  if (groupEls.length > 0 && wordEls.length > 0) {
    wordsPerGroup = Math.round(wordEls.length / groupEls.length);
    if (wordsPerGroup < 1) {
      wordsPerGroup = 1;
    }
  }

  // Step 4: Build the caption model with inferred grouping
  const model = buildCaptionModel(transcript, {
    width: compositionWidth,
    height: compositionHeight,
    duration: compositionDuration,
    wordsPerGroup,
  });

  // Step 5: Read computed styles from the first word or group element
  const firstWordEl = wordEls.item(0) as Element | null;
  const firstGroupEl = groupEls.item(0) as Element | null;
  const styleSourceEl = firstWordEl ?? firstGroupEl;

  if (styleSourceEl) {
    const computed = iframeWin.getComputedStyle(styleSourceEl);

    // Build partial style overrides from computed values
    const styleOverrides: Partial<CaptionStyle> = {};

    const fontSize = parseFloat(computed.fontSize);
    if (!isNaN(fontSize) && fontSize > 0) {
      styleOverrides.fontSize = fontSize;
    }

    const fontWeight = computed.fontWeight;
    if (fontWeight) {
      const numericWeight = parseInt(fontWeight, 10);
      styleOverrides.fontWeight = isNaN(numericWeight) ? fontWeight : numericWeight;
    }

    const fontFamily = computed.fontFamily;
    if (fontFamily) {
      styleOverrides.fontFamily = fontFamily;
    }

    const color = computed.color;
    if (color) {
      styleOverrides.color = color;
    }

    const textTransform = computed.textTransform as CaptionStyle["textTransform"];
    if (
      textTransform === "none" ||
      textTransform === "uppercase" ||
      textTransform === "lowercase" ||
      textTransform === "capitalize"
    ) {
      styleOverrides.textTransform = textTransform;
    }

    const letterSpacing = computed.letterSpacing;
    if (letterSpacing && letterSpacing !== "normal") {
      const lsPx = parseFloat(letterSpacing);
      const fsPx = styleOverrides.fontSize ?? DEFAULT_STYLE.fontSize;
      if (!isNaN(lsPx) && fsPx > 0) {
        // Convert px to em
        styleOverrides.letterSpacing = lsPx / fsPx;
      }
    }

    // Step 6: Read container styles from group element (if visible background)
    const containerOverrides: Partial<CaptionContainerStyle> = {};

    if (firstGroupEl) {
      const groupComputed = iframeWin.getComputedStyle(firstGroupEl);
      const bgColor = groupComputed.backgroundColor;
      // Only apply if it's not transparent/none
      if (bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent") {
        containerOverrides.backgroundColor = bgColor;
        containerOverrides.backgroundOpacity = 1;
      }

      const borderRadius = parseFloat(groupComputed.borderRadius);
      if (!isNaN(borderRadius) && borderRadius > 0) {
        containerOverrides.borderRadius = borderRadius;
      }

      // Parse padding shorthand or individual values
      const paddingTop = parseFloat(groupComputed.paddingTop);
      const paddingRight = parseFloat(groupComputed.paddingRight);
      const paddingBottom = parseFloat(groupComputed.paddingBottom);
      const paddingLeft = parseFloat(groupComputed.paddingLeft);
      if (!isNaN(paddingTop)) containerOverrides.paddingTop = paddingTop;
      if (!isNaN(paddingRight)) containerOverrides.paddingRight = paddingRight;
      if (!isNaN(paddingBottom)) containerOverrides.paddingBottom = paddingBottom;
      if (!isNaN(paddingLeft)) containerOverrides.paddingLeft = paddingLeft;
    }

    // Step 7: Apply extracted styles to all groups in the model
    for (const groupId of model.groupOrder) {
      const group = model.groups.get(groupId);
      if (!group) continue;

      group.style = { ...group.style, ...styleOverrides };
      group.containerStyle = { ...group.containerStyle, ...containerOverrides };
    }
  }

  return model;
}

/**
 * Parses a JS array literal containing `{ text, start, end }` objects.
 *
 * Handles:
 * - Double-quoted and single-quoted string values
 * - Trailing commas after the last element or property
 * - Unquoted property keys (standard JS object literal syntax)
 * - Numeric values for start/end
 */
function parseTranscriptArray(arrayLiteral: string): TranscriptWord[] {
  // Try parsing as-is first (handles already-valid JSON)
  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayLiteral);
  } catch {
    // Not valid JSON — normalize single quotes, unquoted keys, trailing commas
    let normalized = arrayLiteral;
    normalized = normalized.replace(/'((?:[^'\\]|\\.)*)'/g, (_match, inner) => {
      const escaped = inner.replace(/\\'/g, "'").replace(/"/g, '\\"');
      return `"${escaped}"`;
    });
    normalized = normalized.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    normalized = normalized.replace(/,(\s*[}\]])/g, "$1");
    parsed = JSON.parse(normalized);
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const words: TranscriptWord[] = [];
  for (const item of parsed) {
    if (
      item !== null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).text === "string" &&
      typeof (item as Record<string, unknown>).start === "number" &&
      typeof (item as Record<string, unknown>).end === "number"
    ) {
      const entry = item as Record<string, unknown>;
      words.push({
        ...(typeof entry.id === "string" ? { id: entry.id } : {}),
        text: entry.text as string,
        start: entry.start as number,
        end: entry.end as number,
      });
    }
  }

  return words;
}
