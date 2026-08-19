/**
 * Browser-safe authored composition contract.
 *
 * Source HTML is authored with data-start + data-duration + data-track-index.
 * data-end is compiler-derived and data-layer is legacy input only. Readers
 * accept legacy documents; writers always emit the canonical representation.
 */

export const COMPOSITION_CONTRACT_VERSION = 1 as const;

export const COMPOSITION_ATTRIBUTES = Object.freeze({
  start: "data-start",
  duration: "data-duration",
  trackIndex: "data-track-index",
  derivedEnd: "data-end",
  legacyTrack: "data-layer",
} as const);

export const CANONICAL_AUTHORED_TIMING_ATTRIBUTES = Object.freeze([
  COMPOSITION_ATTRIBUTES.start,
  COMPOSITION_ATTRIBUTES.duration,
  COMPOSITION_ATTRIBUTES.trackIndex,
] as const);

export const DERIVED_TIMING_ATTRIBUTES = Object.freeze([
  COMPOSITION_ATTRIBUTES.derivedEnd,
] as const);

export const LEGACY_TIMING_ATTRIBUTES = Object.freeze([
  COMPOSITION_ATTRIBUTES.derivedEnd,
  COMPOSITION_ATTRIBUTES.legacyTrack,
] as const);

export type ReferenceExpression =
  | { kind: "absolute"; value: number }
  | { kind: "reference"; refId: string; offset: number };

export type ClipTimingDiagnosticCode =
  | "invalid-start"
  | "unresolved-start-reference"
  | "invalid-duration"
  | "invalid-end"
  | "end-before-start"
  | "deprecated-end"
  | "conflicting-end"
  | "invalid-track-index"
  | "deprecated-layer"
  | "conflicting-layer";

export interface ClipTimingDiagnostic {
  code: ClipTimingDiagnosticCode;
  attribute: string;
  value: string | null;
}

export interface ClipAttributeReader {
  getAttribute(name: string): string | null;
}

export interface ClipAttributeWriter extends ClipAttributeReader {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface ReadClipTimingOptions {
  /** Resolve a reference to the referenced clip's absolute end time. */
  resolveReferenceEnd?: (refId: string) => number | null | undefined;
  /** Start used when data-start is absent. Defaults to zero. */
  defaultStart?: number | null;
}

export interface ClipTiming {
  startExpression: ReferenceExpression | null;
  start: number | null;
  duration: number | null;
  end: number | null;
  trackIndex: number;
  durationSource: "duration" | "legacy-end" | "missing" | "invalid";
  trackSource: "track-index" | "legacy-layer" | "default" | "invalid";
  diagnostics: ClipTimingDiagnostic[];
}

export interface ClipTimingUpdate {
  start?: number | string | ReferenceExpression;
  duration?: number | null;
  trackIndex?: number | null;
}

export class ClipTimingWriteError extends Error {
  readonly code: "invalid-start" | "invalid-duration" | "invalid-track-index";

  constructor(code: ClipTimingWriteError["code"], message: string) {
    super(message);
    this.name = "ClipTimingWriteError";
    this.code = code;
  }
}

/** Parse a value to a finite number, or null if it is absent/invalid. */
export function parseNumeric(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const REFERENCE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

function isAsciiDigitAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 48 && code <= 57;
}

function skipDigitsLeft(value: string, start: number): number {
  let cursor = start;
  while (cursor >= 0 && isAsciiDigitAt(value, cursor)) cursor--;
  return cursor;
}

function skipWhitespaceLeft(value: string, start: number): number {
  let cursor = start;
  while (cursor >= 0 && (value[cursor] ?? "").trim() === "") cursor--;
  return cursor;
}

function findMagnitudeStart(value: string): number | null {
  const last = value.length - 1;
  if (!isAsciiDigitAt(value, last)) return null;
  let cursor = skipDigitsLeft(value, last);
  if (value[cursor] === ".") cursor = skipDigitsLeft(value, cursor - 1);
  return cursor + 1;
}

function parseReferenceOffset(
  value: string,
): { refId: string; operator: "+" | "-"; magnitude: number } | null {
  const magnitudeStart = findMagnitudeStart(value);
  if (magnitudeStart == null) return null;
  const operatorIndex = skipWhitespaceLeft(value, magnitudeStart - 1);
  const operator = value[operatorIndex];
  if (operator !== "+" && operator !== "-") return null;

  const refId = value.slice(0, operatorIndex).trim();
  if (!REFERENCE_ID_PATTERN.test(refId)) return null;
  const magnitude = Number(value.slice(magnitudeStart));
  if (!Number.isFinite(magnitude)) return null;
  return { refId, operator, magnitude };
}

/**
 * Parse the data-start grammar: absolute seconds, `clip-id`, or
 * `clip-id +/- offset`, where references resolve to the referenced clip's end.
 */
export function parseStartExpression(raw: string | null | undefined): ReferenceExpression | null {
  const normalized = (raw ?? "").trim();
  if (!normalized) return null;
  const absolute = parseNumeric(normalized);
  if (absolute != null) return { kind: "absolute", value: absolute };
  if (REFERENCE_ID_PATTERN.test(normalized)) {
    return { kind: "reference", refId: normalized, offset: 0 };
  }
  const reference = parseReferenceOffset(normalized);
  if (!reference) return null;
  return {
    kind: "reference",
    refId: reference.refId,
    offset: reference.operator === "-" ? -reference.magnitude : reference.magnitude,
  };
}

function pushDiagnostic(
  diagnostics: ClipTimingDiagnostic[],
  code: ClipTimingDiagnosticCode,
  attribute: string,
  value: string | null,
): void {
  diagnostics.push({ code, attribute, value });
}

function resolveStart(
  expression: ReferenceExpression | null,
  rawStart: string | null,
  options: ReadClipTimingOptions,
  diagnostics: ClipTimingDiagnostic[],
): number | null {
  if (rawStart == null || rawStart.trim() === "") {
    return options.defaultStart === undefined ? 0 : options.defaultStart;
  }
  if (!expression) {
    pushDiagnostic(diagnostics, "invalid-start", COMPOSITION_ATTRIBUTES.start, rawStart);
    return null;
  }
  if (expression.kind === "absolute") return Math.max(0, expression.value);
  const referencedEnd = options.resolveReferenceEnd?.(expression.refId);
  if (referencedEnd == null || !Number.isFinite(referencedEnd)) {
    pushDiagnostic(
      diagnostics,
      "unresolved-start-reference",
      COMPOSITION_ATTRIBUTES.start,
      rawStart,
    );
    return null;
  }
  return Math.max(0, referencedEnd + expression.offset);
}

type DurationRead = Pick<ClipTiming, "duration" | "end" | "durationSource">;
type TrackRead = Pick<ClipTiming, "trackIndex" | "trackSource">;

// Float pairs like `data-start="0.1" + data-duration="0.2"` add to
// `0.30000000000000004`, so the compiler-emitted `data-end` string can be a few
// ulps off the sum a reader computes from the canonical inputs. Any drift below
// this ceiling is treated as equal for the derived-end reconciliation check —
// well below one 60fps frame (~16.67 ms) and orders of magnitude above the
// worst realistic IEEE-754 residual (~2e-16 s).
const DERIVED_END_EQUALITY_EPSILON_SECONDS = 1e-9;

function derivedEndsAreConsistent(parsedEnd: number, canonicalEnd: number): boolean {
  return Math.abs(parsedEnd - canonicalEnd) <= DERIVED_END_EQUALITY_EPSILON_SECONDS;
}

// Reconcile a `data-end` attribute paired with canonical `data-duration`.
//
// The compiler (`compileTimingAttrs` in @hyperframes/core) writes
// `data-end = data-start + data-duration` into the bundled HTML so the runtime
// can key off a single attribute. That derived attribute is legitimate — it is
// not a legacy authoring shape. Treating it as `deprecated-end` here made the
// linter fire `deprecated_data_end` on the compiler's own output whenever
// StaticGuard re-validated a bundled composition, producing a false-positive
// cluster reported in the field (n=25+ across cli-feedback crons 61-68).
//
// We keep `deprecated-end` for the truly legacy shape (see `readLegacyEnd` —
// `data-end` present without `data-duration`) and for the *conflicting* case
// where an author left a stale `data-end` behind a canonical duration edit; a
// stale end must not be silently overridden without a diagnostic.
function diagnoseDerivedEnd(
  rawEnd: string,
  canonicalEnd: number | null,
  diagnostics: ClipTimingDiagnostic[],
): void {
  const parsedEnd = parseNumeric(rawEnd);
  if (parsedEnd == null) {
    pushDiagnostic(diagnostics, "deprecated-end", COMPOSITION_ATTRIBUTES.derivedEnd, rawEnd);
    pushDiagnostic(diagnostics, "invalid-end", COMPOSITION_ATTRIBUTES.derivedEnd, rawEnd);
    return;
  }
  if (canonicalEnd == null) {
    // Canonical duration exists but resolved end is unknown (e.g. unresolved
    // reference start). Preserve prior behavior — flag as deprecated so authors
    // remove the stale companion attribute.
    pushDiagnostic(diagnostics, "deprecated-end", COMPOSITION_ATTRIBUTES.derivedEnd, rawEnd);
    return;
  }
  if (derivedEndsAreConsistent(parsedEnd, canonicalEnd)) {
    // Compiler-derived (or manually consistent) `data-end` alongside
    // `data-duration` — silent. No diagnostic.
    return;
  }
  pushDiagnostic(diagnostics, "deprecated-end", COMPOSITION_ATTRIBUTES.derivedEnd, rawEnd);
  pushDiagnostic(diagnostics, "conflicting-end", COMPOSITION_ATTRIBUTES.derivedEnd, rawEnd);
}

function readCanonicalDuration(
  rawDuration: string,
  start: number | null,
  diagnostics: ClipTimingDiagnostic[],
): DurationRead {
  const duration = parseNumeric(rawDuration);
  if (duration == null || duration < 0) {
    pushDiagnostic(diagnostics, "invalid-duration", COMPOSITION_ATTRIBUTES.duration, rawDuration);
    return { duration: null, end: null, durationSource: "invalid" };
  }
  return {
    duration,
    end: start == null ? null : start + duration,
    durationSource: "duration",
  };
}

function readLegacyEnd(
  rawEnd: string,
  start: number | null,
  diagnostics: ClipTimingDiagnostic[],
): DurationRead {
  pushDiagnostic(diagnostics, "deprecated-end", COMPOSITION_ATTRIBUTES.derivedEnd, rawEnd);
  const end = parseNumeric(rawEnd);
  if (end == null) {
    pushDiagnostic(diagnostics, "invalid-end", COMPOSITION_ATTRIBUTES.derivedEnd, rawEnd);
    return { duration: null, end: null, durationSource: "invalid" };
  }
  if (start == null) return { duration: null, end, durationSource: "legacy-end" };
  if (end < start) {
    pushDiagnostic(diagnostics, "end-before-start", COMPOSITION_ATTRIBUTES.derivedEnd, rawEnd);
    return { duration: null, end: null, durationSource: "invalid" };
  }
  return { duration: end - start, end, durationSource: "legacy-end" };
}

function readDuration(
  attributes: ClipAttributeReader,
  start: number | null,
  diagnostics: ClipTimingDiagnostic[],
): DurationRead {
  const rawDuration = attributes.getAttribute(COMPOSITION_ATTRIBUTES.duration);
  const rawEnd = attributes.getAttribute(COMPOSITION_ATTRIBUTES.derivedEnd);
  if (rawDuration == null) {
    return rawEnd == null
      ? { duration: null, end: null, durationSource: "missing" }
      : readLegacyEnd(rawEnd, start, diagnostics);
  }
  const canonical = readCanonicalDuration(rawDuration, start, diagnostics);
  if (rawEnd != null) diagnoseDerivedEnd(rawEnd, canonical.end, diagnostics);
  return canonical;
}

function readTrackValue(
  rawValue: string,
  attribute: string,
  source: "track-index" | "legacy-layer",
  diagnostics: ClipTimingDiagnostic[],
): TrackRead {
  const trackIndex = parseNumeric(rawValue);
  if (trackIndex == null || !Number.isInteger(trackIndex)) {
    pushDiagnostic(diagnostics, "invalid-track-index", attribute, rawValue);
    return { trackIndex: 0, trackSource: "invalid" };
  }
  return { trackIndex, trackSource: source };
}

function readTrack(
  attributes: ClipAttributeReader,
  diagnostics: ClipTimingDiagnostic[],
): TrackRead {
  const rawTrack = attributes.getAttribute(COMPOSITION_ATTRIBUTES.trackIndex);
  const rawLayer = attributes.getAttribute(COMPOSITION_ATTRIBUTES.legacyTrack);
  if (rawTrack == null && rawLayer == null) return { trackIndex: 0, trackSource: "default" };
  if (rawTrack == null && rawLayer != null) {
    pushDiagnostic(diagnostics, "deprecated-layer", COMPOSITION_ATTRIBUTES.legacyTrack, rawLayer);
    return readTrackValue(
      rawLayer,
      COMPOSITION_ATTRIBUTES.legacyTrack,
      "legacy-layer",
      diagnostics,
    );
  }
  const canonical = readTrackValue(
    rawTrack ?? "",
    COMPOSITION_ATTRIBUTES.trackIndex,
    "track-index",
    diagnostics,
  );
  if (rawLayer == null) return canonical;
  pushDiagnostic(diagnostics, "deprecated-layer", COMPOSITION_ATTRIBUTES.legacyTrack, rawLayer);
  const parsedLayer = parseNumeric(rawLayer);
  if (parsedLayer != null && parsedLayer !== canonical.trackIndex) {
    pushDiagnostic(diagnostics, "conflicting-layer", COMPOSITION_ATTRIBUTES.legacyTrack, rawLayer);
  }
  return canonical;
}

/** Read canonical timing, accepting legacy attributes without preferring them. */
export function readClipTiming(
  attributes: ClipAttributeReader,
  options: ReadClipTimingOptions = {},
): ClipTiming {
  const diagnostics: ClipTimingDiagnostic[] = [];
  const rawStart = attributes.getAttribute(COMPOSITION_ATTRIBUTES.start);
  const startExpression = parseStartExpression(rawStart);
  const start = resolveStart(startExpression, rawStart, options, diagnostics);
  const duration = readDuration(attributes, start, diagnostics);
  const track = readTrack(attributes, diagnostics);
  return { startExpression, start, ...duration, ...track, diagnostics };
}

function serializeStartNumber(start: number): string {
  if (!Number.isFinite(start)) {
    throw new ClipTimingWriteError("invalid-start", "start must be finite");
  }
  return String(start);
}

function serializeStartReference(start: ReferenceExpression): string {
  if (start.kind === "absolute") return serializeStartNumber(start.value);
  if (!start.refId || !Number.isFinite(start.offset)) {
    throw new ClipTimingWriteError(
      "invalid-start",
      "reference start must have an id and finite offset",
    );
  }
  if (start.offset === 0) return start.refId;
  return `${start.refId} ${start.offset < 0 ? "-" : "+"} ${Math.abs(start.offset)}`;
}

function serializeStart(start: ClipTimingUpdate["start"]): string {
  if (typeof start === "number") return serializeStartNumber(start);
  if (typeof start === "object" && start != null) return serializeStartReference(start);
  if (typeof start === "string" && parseStartExpression(start)) return start.trim();
  throw new ClipTimingWriteError("invalid-start", `invalid start expression: ${start ?? ""}`);
}

function writeDuration(
  attributes: ClipAttributeWriter,
  duration: number | null | undefined,
  current: ClipTiming,
): void {
  if (duration === null) {
    attributes.removeAttribute(COMPOSITION_ATTRIBUTES.duration);
    return;
  }
  if (duration === undefined) {
    if (
      attributes.getAttribute(COMPOSITION_ATTRIBUTES.duration) == null &&
      current.duration != null
    ) {
      attributes.setAttribute(COMPOSITION_ATTRIBUTES.duration, String(current.duration));
    }
    return;
  }
  if (!Number.isFinite(duration) || duration < 0) {
    throw new ClipTimingWriteError(
      "invalid-duration",
      "duration must be a finite, non-negative number",
    );
  }
  attributes.setAttribute(COMPOSITION_ATTRIBUTES.duration, String(duration));
}

function writeTrack(
  attributes: ClipAttributeWriter,
  trackIndex: number | null | undefined,
  current: ClipTiming,
): void {
  if (trackIndex === null) {
    attributes.removeAttribute(COMPOSITION_ATTRIBUTES.trackIndex);
    return;
  }
  if (trackIndex === undefined) {
    if (
      attributes.getAttribute(COMPOSITION_ATTRIBUTES.trackIndex) == null &&
      current.trackSource === "legacy-layer"
    ) {
      attributes.setAttribute(COMPOSITION_ATTRIBUTES.trackIndex, String(current.trackIndex));
    }
    return;
  }
  if (!Number.isFinite(trackIndex) || !Number.isInteger(trackIndex)) {
    throw new ClipTimingWriteError("invalid-track-index", "trackIndex must be a finite integer");
  }
  attributes.setAttribute(COMPOSITION_ATTRIBUTES.trackIndex, String(trackIndex));
}

/** Write only canonical authored timing and remove derived/legacy source attributes. */
export function writeClipTiming(
  attributes: ClipAttributeWriter,
  update: ClipTimingUpdate,
): ClipTiming {
  const current = readClipTiming(attributes);
  if (update.start !== undefined) {
    attributes.setAttribute(COMPOSITION_ATTRIBUTES.start, serializeStart(update.start));
  }
  writeDuration(attributes, update.duration, current);
  writeTrack(attributes, update.trackIndex, current);
  // A legacy end paired with an unresolved reference start cannot be converted
  // to data-duration without a reference resolver. On a duration-omitting edit
  // (for example, moving only the track), preserve that sole duration source
  // instead of canonicalizing it into data loss.
  const preserveUnresolvedLegacyEnd =
    update.duration === undefined &&
    attributes.getAttribute(COMPOSITION_ATTRIBUTES.duration) == null &&
    attributes.getAttribute(COMPOSITION_ATTRIBUTES.derivedEnd) != null &&
    current.duration == null;
  if (!preserveUnresolvedLegacyEnd) {
    attributes.removeAttribute(COMPOSITION_ATTRIBUTES.derivedEnd);
  }
  attributes.removeAttribute(COMPOSITION_ATTRIBUTES.legacyTrack);
  return readClipTiming(attributes);
}
