import {
  isWebCaptureProducerDiagnosticCode,
  normalizeWebCaptureDiagnostics,
  WebCaptureDiagnosticError,
  type WebCaptureDiagnostic,
} from "./webCaptureDiagnostics";
import {
  canonicalStringify,
  normalizeDomString,
  scanJsonGrammar,
  sha256Hex,
  utf8ByteLength,
} from "./webCaptureCanonicalJson";
import { WEB_CAPTURE_BUDGETS, withinWebCaptureBudget } from "./webCaptureBudgets";
import { validateWebCaptureQuotas } from "./webCaptureQuotas";
import {
  prepareWebCaptureResource,
  validateWebCaptureResourceMaterialization,
  validateWebCaptureUniqueResourceIds,
  withinWebCaptureResourcePhase,
  type WebCapturePreparedResource,
} from "./webCaptureResourceInspection";
import type {
  WebCaptureArtifact,
  WebCaptureBuildResult,
  WebCaptureClaims,
  WebCaptureEnvelope,
  WebCaptureEnvelopeInput,
  WebCaptureFailure,
  WebCaptureParseResult,
  WebCaptureResource,
  WebCaptureValidationOptions,
} from "./webCaptureTypes";

export { sha256Hex, utf8ByteLength } from "./webCaptureCanonicalJson";
export {
  WEB_CAPTURE_BUDGETS,
  withinWebCaptureBudget,
  type WebCaptureBudget,
} from "./webCaptureBudgets";
export {
  WEB_CAPTURE_FAILURE_CODES,
  WEB_CAPTURE_PRODUCER_DIAGNOSTICS,
  WEB_CAPTURE_REJECTION_REASONS,
  type WebCaptureFailureCode,
  type WebCaptureProducerDiagnosticCode,
  type WebCaptureRejectionReason,
} from "./webCaptureDiagnostics";
export type * from "./webCaptureTypes";

export const WEB_CAPTURE_ROUTE_PREFIX = "hyperframes-web-capture";
export const WEB_CAPTURE_CUSTOM_MIME = "web application/vnd.hyperframes.web-capture+json";
export const WEB_CAPTURE_VERSION = "2.0";
export const WEB_CAPTURE_AUDIENCE = "hyperframes-studio";
export const WEB_CAPTURE_REPRESENTATION_KINDS = [
  "editable-dom",
  "finite-local-media",
  "still",
  "rejected",
] as const;

type JsonRecord = Record<string, unknown>;
type ValidationResult<T> = { ok: true; value: T } | WebCaptureFailure;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
): WebCaptureFailure | null {
  const key = Object.keys(value)
    .filter((candidate) => !allowed.includes(candidate))
    .sort()[0];
  return key === undefined ? null : { ok: false, code: "schema.unknown-key", path, key };
}

function invalid(path: string): WebCaptureFailure {
  return { ok: false, code: "schema.invalid", path };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validDimensions(width: unknown, height: unknown): width is number {
  return isPositiveInteger(width) && isPositiveInteger(height);
}

function invalidArtifact(): WebCaptureFailure {
  return { ok: false, code: "schema.invalid-artifact" };
}

function isEditableArtifact(value: JsonRecord): boolean {
  return (
    typeof value.html === "string" &&
    typeof value.css === "string" &&
    validDimensions(value.width, value.height)
  );
}

function isResourceArtifact(value: JsonRecord): boolean {
  return (
    typeof value.resourceId === "string" &&
    value.resourceId.length > 0 &&
    validDimensions(value.width, value.height)
  );
}

function validateKnownArtifact(
  value: JsonRecord,
  allowed: readonly string[],
  valid: boolean,
): ValidationResult<WebCaptureArtifact> {
  const extra = unknownKey(value, allowed, "$.artifact");
  if (extra) return extra;
  return valid ? { ok: true, value: value as unknown as WebCaptureArtifact } : invalidArtifact();
}

function validateArtifact(value: unknown): ValidationResult<WebCaptureArtifact> {
  if (!isRecord(value) || typeof value.kind !== "string") return invalidArtifact();
  switch (value.kind) {
    case "editable-dom":
      return validateKnownArtifact(
        value,
        ["kind", "html", "css", "width", "height"],
        isEditableArtifact(value),
      );
    case "finite-local-media":
      return validateKnownArtifact(
        value,
        ["kind", "resourceId", "width", "height"],
        isResourceArtifact(value),
      );
    case "still":
      return validateKnownArtifact(
        value,
        ["kind", "resourceId", "width", "height", "completeness"],
        isResourceArtifact(value) &&
          (value.completeness === "complete" || value.completeness === "cropped"),
      );
    default:
      return invalidArtifact();
  }
}

const RESOURCE_SHARED_KEYS = ["id", "kind", "mime", "bytes", "sha256", "data"] as const;
const RESOURCE_DIMENSION_KEYS = [...RESOURCE_SHARED_KEYS, "width", "height"] as const;
const RESOURCE_FONT_KEYS = [...RESOURCE_SHARED_KEYS, "decodedBytes"] as const;

function resourceKeys(kind: string): readonly string[] {
  if (kind === "media") return [...RESOURCE_DIMENSION_KEYS, "durationMs"];
  if (kind === "font") return RESOURCE_FONT_KEYS;
  return kind === "model" ? RESOURCE_SHARED_KEYS : RESOURCE_DIMENSION_KEYS;
}

function hasValidResourceBase(value: JsonRecord): boolean {
  return (
    typeof value.id === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/.test(value.id) &&
    isPositiveInteger(value.bytes) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.data === "string"
  );
}

function hasValidResourceVariant(value: JsonRecord): boolean {
  switch (value.kind) {
    case "image":
      return (
        ["image/png", "image/jpeg", "image/webp"].includes(String(value.mime)) &&
        validDimensions(value.width, value.height)
      );
    case "font":
      return value.mime === "font/woff2" && isPositiveInteger(value.decodedBytes);
    case "media":
      return (
        ["video/webm", "video/mp4"].includes(String(value.mime)) &&
        validDimensions(value.width, value.height) &&
        isPositiveInteger(value.durationMs)
      );
    case "model":
      return value.mime === "model/gltf-binary";
    default:
      return false;
  }
}

function validateResource(value: unknown, index: number): ValidationResult<WebCaptureResource> {
  const path = `$.resources[${index}]`;
  if (!isRecord(value) || typeof value.kind !== "string") return invalid(path);
  const extra = unknownKey(value, resourceKeys(value.kind), path);
  if (extra) return extra;
  return hasValidResourceBase(value) && hasValidResourceVariant(value)
    ? { ok: true, value: value as unknown as WebCaptureResource }
    : invalid(path);
}

function validateDiagnostics(value: unknown): ValidationResult<WebCaptureDiagnostic[]> {
  if (!Array.isArray(value)) return invalid("$.diagnostics");
  const diagnostics: WebCaptureDiagnostic[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `$.diagnostics[${index}]`;
    if (!isRecord(candidate)) return invalid(path);
    const extra = unknownKey(candidate, ["code", "count"], path);
    if (extra) return extra;
    if (
      typeof candidate.code !== "string" ||
      !isWebCaptureProducerDiagnosticCode(candidate.code) ||
      !isPositiveInteger(candidate.count)
    ) {
      return invalid(path);
    }
    diagnostics.push({ code: candidate.code, count: candidate.count });
  }
  const normalized = normalizeWebCaptureDiagnostics(diagnostics);
  return canonicalStringify(diagnostics) === canonicalStringify(normalized)
    ? { ok: true, value: normalized }
    : invalid("$.diagnostics");
}

function validateSourceFrame(value: unknown): WebCaptureFailure | null {
  if (!isRecord(value)) return invalid("$.claims.sourceFrame");
  const extra = unknownKey(value, ["width", "height", "devicePixelRatio"], "$.claims.sourceFrame");
  if (extra) return extra;
  const validDpr =
    typeof value.devicePixelRatio === "number" &&
    Number.isFinite(value.devicePixelRatio) &&
    value.devicePixelRatio > 0;
  return validDimensions(value.width, value.height) && validDpr
    ? null
    : invalid("$.claims.sourceFrame");
}

function validateLockedTimeClaim(value: JsonRecord): WebCaptureFailure | null {
  const extra = unknownKey(value, ["kind", "atMs"], "$.claims.time");
  if (extra) return extra;
  return isNonNegativeNumber(value.atMs) ? null : invalid("$.claims.time.atMs");
}

function validateFiniteTimeClaim(value: JsonRecord): WebCaptureFailure | null {
  const extra = unknownKey(value, ["kind", "durationMs", "deterministicSeek"], "$.claims.time");
  if (extra) return extra;
  if (!isPositiveInteger(value.durationMs)) return invalid("$.claims.time");
  return typeof value.deterministicSeek === "boolean" ? null : invalid("$.claims.time");
}

function validateTimeClaim(value: unknown): WebCaptureFailure | null {
  if (!isRecord(value) || typeof value.kind !== "string") return invalid("$.claims.time");
  if (value.kind === "locked-frame") return validateLockedTimeClaim(value);
  return value.kind === "finite-local-media"
    ? validateFiniteTimeClaim(value)
    : invalid("$.claims.time.kind");
}

function validateClaims(value: unknown): ValidationResult<WebCaptureClaims> {
  if (!isRecord(value)) return invalid("$.claims");
  const extra = unknownKey(value, ["sourceFrame", "time", "reflow"], "$.claims");
  if (extra) return extra;
  const frameFailure = validateSourceFrame(value.sourceFrame);
  if (frameFailure) return frameFailure;
  const timeFailure = validateTimeClaim(value.time);
  if (timeFailure) return timeFailure;
  if (value.reflow !== "fixed-viewport") return invalid("$.claims.reflow");
  return { ok: true, value: value as unknown as WebCaptureClaims };
}

function validateResources(value: unknown): ValidationResult<WebCaptureResource[]> {
  if (!Array.isArray(value)) return invalid("$.resources");
  const resources: WebCaptureResource[] = [];
  for (const [index, resource] of value.entries()) {
    const parsed = validateResource(resource, index);
    if (!parsed.ok) return parsed;
    resources.push(parsed.value);
  }
  return { ok: true, value: resources };
}

function artifactTimeMatches(artifact: WebCaptureArtifact, claims: WebCaptureClaims): boolean {
  return artifact.kind === "finite-local-media"
    ? claims.time.kind === "finite-local-media"
    : claims.time.kind === "locked-frame";
}

function validateEnvelopeInput(value: unknown): ValidationResult<WebCaptureEnvelopeInput> {
  if (!isRecord(value)) return invalid("$");
  const extra = unknownKey(value, ["artifact", "resources", "diagnostics", "claims"], "$input");
  if (extra) return extra;
  const artifact = validateArtifact(value.artifact);
  if (!artifact.ok) return artifact;
  const resources = validateResources(value.resources);
  if (!resources.ok) return resources;
  const diagnostics = validateDiagnostics(value.diagnostics);
  if (!diagnostics.ok) return diagnostics;
  const claims = validateClaims(value.claims);
  if (!claims.ok) return claims;
  if (!artifactTimeMatches(artifact.value, claims.value)) return invalid("$.claims.time");
  return {
    ok: true,
    value: {
      artifact: artifact.value,
      resources: resources.value,
      diagnostics: diagnostics.value,
      claims: claims.value,
    },
  };
}

function validateArtifactResource(input: WebCaptureEnvelopeInput): WebCaptureFailure | null {
  const artifact = input.artifact;
  if (artifact.kind === "editable-dom") return null;
  const resource = input.resources.find(({ id }) => id === artifact.resourceId);
  if (!resourceMatchesArtifact(resource, artifact)) return invalid("$.artifact.resourceId");
  if (artifact.kind !== "finite-local-media") return null;
  const durationMatches =
    resource.kind === "media" &&
    input.claims.time.kind === "finite-local-media" &&
    resource.durationMs === input.claims.time.durationMs;
  return durationMatches ? null : invalid("$.claims.time.durationMs");
}

function resourceMatchesArtifact(
  resource: WebCaptureResource | undefined,
  artifact: Exclude<WebCaptureArtifact, { kind: "editable-dom" }>,
): resource is Exclude<WebCaptureResource, { kind: "font" }> {
  const expectedKind = artifact.kind === "finite-local-media" ? "media" : "image";
  return (
    resource?.kind === expectedKind &&
    resource.width === artifact.width &&
    resource.height === artifact.height
  );
}

async function validateResourceContents(
  input: WebCaptureEnvelopeInput,
  options: WebCaptureValidationOptions,
): Promise<WebCaptureFailure | null> {
  const idFailure = validateWebCaptureUniqueResourceIds(input.resources);
  if (idFailure) return idFailure;
  const artifactFailure = validateArtifactResource(input);
  if (artifactFailure) return artifactFailure;
  const prepared: WebCapturePreparedResource[] = [];
  for (const resource of input.resources) {
    const result = await prepareWebCaptureResource(resource);
    if (!result.ok) return result;
    prepared.push(result.value);
  }
  return withinWebCaptureResourcePhase(options.signal, async (signal) => {
    for (const { resource, bytes, inspected } of prepared) {
      const materializationFailure = await validateWebCaptureResourceMaterialization(
        resource,
        bytes,
        inspected,
        options.materializeResource,
        signal,
      );
      if (materializationFailure) return materializationFailure;
    }
    return null;
  });
}

function normalizeInput(input: WebCaptureEnvelopeInput): ValidationResult<WebCaptureEnvelopeInput> {
  try {
    const artifact =
      input.artifact.kind === "editable-dom"
        ? {
            ...input.artifact,
            html: normalizeDomString(input.artifact.html),
            css: normalizeDomString(input.artifact.css),
          }
        : input.artifact;
    return validateEnvelopeInput({
      ...input,
      artifact,
      diagnostics: normalizeWebCaptureDiagnostics(input.diagnostics),
    });
  } catch (error) {
    if (error instanceof WebCaptureDiagnosticError) return invalid("$.diagnostics");
    throw error;
  }
}

function envelopeWithoutIntegrity(
  envelope: WebCaptureEnvelope,
): Omit<WebCaptureEnvelope, "integrity"> {
  const { integrity: _integrity, ...payload } = envelope;
  return payload;
}

export async function buildWebCaptureText(
  input: WebCaptureEnvelopeInput,
  options: WebCaptureValidationOptions,
): Promise<WebCaptureBuildResult> {
  const validated = normalizeInput(input);
  if (!validated.ok) return validated;
  const quotaFailure = validateWebCaptureQuotas(validated.value);
  if (quotaFailure) return quotaFailure;
  const payload = {
    version: WEB_CAPTURE_VERSION,
    audience: WEB_CAPTURE_AUDIENCE,
    ...validated.value,
  } as const;
  const digest = await sha256Hex(new TextEncoder().encode(canonicalStringify(payload)));
  const envelope: WebCaptureEnvelope = {
    ...payload,
    integrity: {
      algorithm: "SHA-256",
      scope: "canonical-envelope-without-integrity",
      digest,
    },
  };
  const text = `${WEB_CAPTURE_ROUTE_PREFIX}\n${canonicalStringify(envelope)}`;
  const actual = utf8ByteLength(text);
  if (!withinWebCaptureBudget("finalUtf8Bytes", actual)) {
    return {
      ok: false,
      code: "budget.final-utf8-bytes",
      actual,
      limit: WEB_CAPTURE_BUDGETS.finalUtf8Bytes,
    };
  }
  const resourceFailure = await validateResourceContents(validated.value, options);
  if (resourceFailure) return resourceFailure;
  return { ok: true, text, envelope };
}

function validateIntegrity(value: unknown): ValidationResult<WebCaptureEnvelope["integrity"]> {
  if (!isRecord(value)) return invalid("$.integrity");
  const integrityExtra = unknownKey(value, ["algorithm", "scope", "digest"], "$.integrity");
  if (integrityExtra) return integrityExtra;
  if (
    value.algorithm !== "SHA-256" ||
    value.scope !== "canonical-envelope-without-integrity" ||
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest)
  ) {
    return invalid("$.integrity");
  }
  return { ok: true, value: value as unknown as WebCaptureEnvelope["integrity"] };
}

function parseEnvelope(value: unknown): ValidationResult<WebCaptureEnvelope> {
  if (!isRecord(value)) return invalid("$");
  const extra = unknownKey(
    value,
    ["version", "audience", "artifact", "resources", "diagnostics", "claims", "integrity"],
    "$",
  );
  if (extra) return extra;
  if (value.version !== WEB_CAPTURE_VERSION || value.audience !== WEB_CAPTURE_AUDIENCE) {
    return invalid("$");
  }
  const input = validateEnvelopeInput({
    artifact: value.artifact,
    resources: value.resources,
    diagnostics: value.diagnostics,
    claims: value.claims,
  });
  if (!input.ok) return input;
  const integrity = validateIntegrity(value.integrity);
  if (!integrity.ok) return integrity;
  return {
    ok: true,
    value: {
      version: WEB_CAPTURE_VERSION,
      audience: WEB_CAPTURE_AUDIENCE,
      ...input.value,
      integrity: integrity.value,
    },
  };
}

function validateRoute(text: string): WebCaptureFailure | null {
  if (text.startsWith("hyperframes-clipboard:v1")) {
    return { ok: false, code: "protocol.legacy-v1" };
  }
  const prefix = `${WEB_CAPTURE_ROUTE_PREFIX}\n`;
  if (!text.startsWith(prefix)) {
    return text.startsWith(WEB_CAPTURE_ROUTE_PREFIX)
      ? { ok: false, code: "grammar.malformed" }
      : { ok: false, code: "route.unrecognized" };
  }
  const actual = utf8ByteLength(text);
  if (!withinWebCaptureBudget("finalUtf8Bytes", actual)) {
    return {
      ok: false,
      code: "budget.final-utf8-bytes",
      actual,
      limit: WEB_CAPTURE_BUDGETS.finalUtf8Bytes,
    };
  }
  return null;
}

function parseCanonicalJson(json: string): ValidationResult<unknown> {
  const grammar = scanJsonGrammar(json);
  if (!grammar.ok) {
    return grammar.code === "duplicate-key"
      ? { ok: false, code: "grammar.duplicate-key", key: grammar.key }
      : { ok: false, code: "grammar.malformed" };
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (canonicalStringify(parsed) !== json) {
      return { ok: false, code: "grammar.non-canonical" };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return { ok: false, code: "grammar.malformed" };
    }
    throw error;
  }
}

function unsupportedVersion(value: unknown): WebCaptureFailure | null {
  if (!isRecord(value) || typeof value.version !== "string") return null;
  return value.version === WEB_CAPTURE_VERSION
    ? null
    : { ok: false, code: "protocol.unsupported-version", version: value.version };
}

async function validateEnvelopeDigest(
  envelope: WebCaptureEnvelope,
): Promise<WebCaptureFailure | null> {
  const expected = await sha256Hex(
    new TextEncoder().encode(canonicalStringify(envelopeWithoutIntegrity(envelope))),
  );
  return expected === envelope.integrity.digest
    ? null
    : { ok: false, code: "integrity.digest-mismatch" };
}

export async function parseWebCaptureText(
  sourceText: string,
  options: WebCaptureValidationOptions,
): Promise<WebCaptureParseResult> {
  const text = normalizeDomString(sourceText);
  if (options.customMimeText !== undefined && normalizeDomString(options.customMimeText) !== text) {
    return { ok: false, code: "clipboard.mime-mismatch" };
  }
  const routeFailure = validateRoute(text);
  if (routeFailure) return routeFailure;
  const parsed = parseCanonicalJson(text.slice(`${WEB_CAPTURE_ROUTE_PREFIX}\n`.length));
  if (!parsed.ok) return parsed;
  const versionFailure = unsupportedVersion(parsed.value);
  if (versionFailure) return versionFailure;
  const envelope = parseEnvelope(parsed.value);
  if (!envelope.ok) return envelope;
  const integrityFailure = await validateEnvelopeDigest(envelope.value);
  if (integrityFailure) return integrityFailure;
  const quotaFailure = validateWebCaptureQuotas(envelope.value);
  if (quotaFailure) return quotaFailure;
  const resourceFailure = await validateResourceContents(envelope.value, options);
  if (resourceFailure) return resourceFailure;
  return { ok: true, canonicalText: text, envelope: envelope.value };
}
