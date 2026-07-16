/**
 * Pure, DOM-free editing-affordance resolution. Single source of truth for what
 * the studio's edit panel (and any SDK consumer) surfaces per selected element:
 * capability flags + which section types apply. No getComputedStyle, no DOM —
 * the caller supplies normalized facts (live or static). See the SDK adapter
 * (browser-only) and the studio mapper for the two fact extractors.
 */

export interface DomEditCapabilities {
  canSelect: boolean;
  canEditStyles: boolean;
  /** Can take a non-destructive `clip-path: inset()` crop. Broader than
   *  canEditStyles: a sub-composition host can be cropped from the parent view
   *  (the crop is a viewport clip that persists on the host in the parent
   *  source), even though its internal styles are edited by drilling in. */
  canCrop: boolean;
  /** Directly editable authored left/top style fields. Canvas drag uses manual edits instead. */
  canMove: boolean;
  /** Directly editable authored width/height style fields. Canvas resize uses manual edits instead. */
  canResize: boolean;
  canApplyManualOffset: boolean;
  canApplyManualSize: boolean;
  canApplyManualRotation: boolean;
  reasonIfDisabled?: string;
}

export interface EditingSectionApplicability {
  text: boolean;
  media: boolean;
  /** Element-level only — the consumer still ANDs its own feature flag. */
  colorGrading: boolean;
  timing: boolean;
  animation: boolean;
  /** Position/size/rotation/stacking — meaningless on an element with no
   *  rendered box (e.g. `<audio>`, which never paints a visual frame). */
  layout: boolean;
  /** Fill/radius/stroke/shadow/blend-mode/clip — same "no rendered box" gate
   *  as `layout`, kept separate since a future tag could need one without
   *  the other. */
  style: boolean;
}

export interface EditingAffordances {
  capabilities: DomEditCapabilities;
  sections: EditingSectionApplicability;
}

export interface EditableElementFacts {
  /** A stable patch target exists (selector|hfId in studio; always true in the SDK model). */
  hasStableTarget: boolean;
  /** Lowercased tag name. */
  tag: string;
  /** kebab-case. Capability logic reads left/top/width/height/transform; sections read nothing here. */
  inlineStyles: Record<string, string>;
  /** kebab-case. Absent => canMove/canResize default to false (no live layout). */
  computedStyles?: Record<string, string>;
  isCompositionHost: boolean;
  isCompositionRoot: boolean;
  isInsideLockedComposition: boolean;
  isMasterView: boolean;
  existsInSource: boolean;
  /** studio: textFields.length > 0 ; SDK: model.text != null */
  hasEditableText: boolean;
  /** data-start present on the element */
  hasTimingStart: boolean;
  /** count of GSAP tweens targeting this element */
  animationCount: number;
}

/**
 * kebab-case px parser. Single source of truth — studio's domEditingDom
 * re-exports this so the two paths can't drift.
 */
export function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.endsWith("px")) return null;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whether a CSS transform is the identity (matrix or matrix3d). Core-internal. */
// fallow-ignore-next-line complexity
function isIdentityTransform(value: string | undefined): boolean {
  const transform = (value ?? "none").trim();
  if (!transform || transform === "none") return true;

  const matrix = transform.match(/^matrix\(([^)]+)\)$/i);
  if (matrix && matrix[1]) {
    const parts = matrix[1].split(",");
    if (parts.length !== 6) return false;
    const values = parts.map((part) => Number.parseFloat(part.trim()));
    if (values.some((part) => !Number.isFinite(part))) return false;
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
    return (
      Math.abs(a - 1) < 0.0001 &&
      Math.abs(b) < 0.0001 &&
      Math.abs(c) < 0.0001 &&
      Math.abs(d - 1) < 0.0001 &&
      Math.abs(e) < 0.0001 &&
      Math.abs(f) < 0.0001
    );
  }

  const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/i);
  if (!matrix3d || !matrix3d[1]) return false;
  const values = matrix3d[1].split(",").map((part) => Number.parseFloat(part.trim()));
  if (values.length !== 16 || values.some((part) => !Number.isFinite(part))) return false;
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return values.every((part, index) => Math.abs(part - (identity[index] ?? 0)) < 0.0001);
}

// fallow-ignore-next-line complexity
function resolveCapabilities(facts: EditableElementFacts): DomEditCapabilities {
  if (!facts.hasStableTarget || facts.isInsideLockedComposition) {
    return {
      canSelect: !facts.isInsideLockedComposition,
      canEditStyles: false,
      canCrop: false,
      canMove: false,
      canResize: false,
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
      reasonIfDisabled: facts.isInsideLockedComposition
        ? "This element belongs to a locked composition."
        : "Studio could not resolve a stable patch target for this element.",
    };
  }

  if (!facts.existsInSource) {
    return {
      canSelect: true,
      canEditStyles: false,
      canCrop: false,
      canMove: false,
      canResize: false,
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
      reasonIfDisabled: "This element is generated by a script and cannot be edited visually.",
    };
  }

  if (facts.isCompositionRoot) {
    return {
      canSelect: true,
      canEditStyles: true,
      canCrop: false, // the root defines the canvas/preview bounds — nothing to crop against
      canMove: false,
      canResize: false,
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
      reasonIfDisabled: "The root composition defines the preview bounds.",
    };
  }

  const computed = facts.computedStyles ?? {};
  const position = computed.position;
  const left = parsePx(facts.inlineStyles.left) ?? parsePx(computed.left);
  const top = parsePx(facts.inlineStyles.top) ?? parsePx(computed.top);
  const width = parsePx(facts.inlineStyles.width) ?? parsePx(computed.width);
  const height = parsePx(facts.inlineStyles.height) ?? parsePx(computed.height);
  const hasTransformDrivenGeometry = !isIdentityTransform(computed.transform);

  const canMove =
    (position === "absolute" || position === "fixed") &&
    left != null &&
    top != null &&
    !hasTransformDrivenGeometry;
  const canResize = canMove && (width != null || height != null);
  const canApplyManualGeometry = !facts.isCompositionHost;
  const reasonIfDisabled = canApplyManualGeometry
    ? undefined
    : "Select an internal layer to transform it.";

  const canEditStyles = !(facts.isCompositionHost && facts.isMasterView);
  // Crop is broader than style editing: a sub-composition host CAN be cropped
  // from the parent view (a viewport clip persisted on the host in the parent
  // source), even though its internal styles are edited by drilling in.
  const canCrop = true;

  return {
    canSelect: true,
    canEditStyles,
    canCrop,
    canMove,
    canResize,
    canApplyManualOffset: canApplyManualGeometry,
    canApplyManualSize: canApplyManualGeometry,
    canApplyManualRotation: canApplyManualGeometry,
    reasonIfDisabled,
  };
}

/**
 * Section applicability only. Reads no style facts, so callers that already
 * hold resolved capabilities (e.g. the studio panel) can compute sections
 * without re-running the capability geometry parse.
 */
export function resolveEditingSections(facts: EditableElementFacts): EditingSectionApplicability {
  // `<audio>` never paints a visual frame — position/size/rotation/stacking
  // and fill/radius/stroke/shadow/etc. are all inert on it. Every other tag
  // (div, img, video, svg, canvas, composition hosts) renders a real box.
  const hasVisualBox = facts.tag !== "audio";
  return {
    text: facts.hasEditableText && !facts.isCompositionHost && !facts.isInsideLockedComposition,
    media: facts.tag === "video" || facts.tag === "audio" || facts.tag === "img",
    colorGrading: facts.tag === "video" || facts.tag === "img",
    timing: facts.hasTimingStart || facts.animationCount > 0,
    animation: facts.animationCount > 0,
    layout: hasVisualBox,
    style: hasVisualBox,
  };
}

export function resolveEditingAffordances(facts: EditableElementFacts): EditingAffordances {
  return { capabilities: resolveCapabilities(facts), sections: resolveEditingSections(facts) };
}
