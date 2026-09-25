import { WEB_CAPTURE_BUDGETS, withinWebCaptureBudget } from "./webCaptureBudgets";
import { utf8ByteLength } from "./webCaptureCanonicalJson";
import type { WebCaptureEnvelopeInput, WebCaptureFailure } from "./webCaptureTypes";

type QuotaFailureCode = Extract<WebCaptureFailure["code"], `budget.${string}`>;

function quotaFailure(code: QuotaFailureCode, actual: number, limit: number): WebCaptureFailure {
  return { ok: false, code, actual, limit };
}

function validateCollectionQuotas(input: WebCaptureEnvelopeInput): WebCaptureFailure | null {
  if (!withinWebCaptureBudget("resources", input.resources.length)) {
    return quotaFailure("budget.resources", input.resources.length, WEB_CAPTURE_BUDGETS.resources);
  }
  const diagnosticCount = input.diagnostics.reduce(
    (total, diagnostic) => total + diagnostic.count,
    0,
  );
  if (!withinWebCaptureBudget("diagnostics", diagnosticCount)) {
    return quotaFailure("budget.diagnostics", diagnosticCount, WEB_CAPTURE_BUDGETS.diagnostics);
  }
  return null;
}

function validateArtifactQuota(input: WebCaptureEnvelopeInput): WebCaptureFailure | null {
  if (input.artifact.kind === "editable-dom") {
    const htmlCssBytes = utf8ByteLength(input.artifact.html) + utf8ByteLength(input.artifact.css);
    if (!withinWebCaptureBudget("htmlCssBytes", htmlCssBytes)) {
      return quotaFailure("budget.html-css-bytes", htmlCssBytes, WEB_CAPTURE_BUDGETS.htmlCssBytes);
    }
  }
  return null;
}

function validateRasterQuotas(input: WebCaptureEnvelopeInput): WebCaptureFailure | null {
  const rasterAreas = [
    input.artifact.width * input.artifact.height,
    input.claims.sourceFrame.width * input.claims.sourceFrame.height,
    ...input.resources.flatMap((resource) =>
      resource.kind === "image" || resource.kind === "media"
        ? [resource.width * resource.height]
        : [],
    ),
  ];
  const rasterPixels = Math.max(...rasterAreas);
  if (!withinWebCaptureBudget("rasterPixels", rasterPixels)) {
    return quotaFailure("budget.raster-pixels", rasterPixels, WEB_CAPTURE_BUDGETS.rasterPixels);
  }
  if (!withinWebCaptureBudget("devicePixelRatio", input.claims.sourceFrame.devicePixelRatio)) {
    return quotaFailure(
      "budget.device-pixel-ratio",
      input.claims.sourceFrame.devicePixelRatio,
      WEB_CAPTURE_BUDGETS.devicePixelRatio,
    );
  }
  return null;
}

function validateMediaQuota(
  resource: Extract<WebCaptureEnvelopeInput["resources"][number], { kind: "media" }>,
): WebCaptureFailure | null {
  const dimension = Math.max(resource.width, resource.height);
  if (!withinWebCaptureBudget("mediaDimension", dimension)) {
    return quotaFailure("budget.media-dimension", dimension, WEB_CAPTURE_BUDGETS.mediaDimension);
  }
  return withinWebCaptureBudget("mediaDurationMs", resource.durationMs)
    ? null
    : quotaFailure(
        "budget.media-duration-ms",
        resource.durationMs,
        WEB_CAPTURE_BUDGETS.mediaDurationMs,
      );
}

interface ResourceTotals {
  materializedBytes: number;
  decodedFontBytes: number;
  decodedPixels: number;
}

type ResourceMeasurement = { ok: true; value: ResourceTotals } | WebCaptureFailure;

function measureResources(input: WebCaptureEnvelopeInput): ResourceMeasurement {
  let materializedBytes = 0;
  let decodedFontBytes = 0;
  let decodedPixels = 0;
  for (const resource of input.resources) {
    if (resource.kind === "font") {
      decodedFontBytes += resource.decodedBytes;
      continue;
    }
    materializedBytes += resource.bytes;
    if (resource.kind === "model") continue;
    decodedPixels += resource.width * resource.height;
    if (resource.kind === "media") {
      const mediaFailure = validateMediaQuota(resource);
      if (mediaFailure) return mediaFailure;
    }
  }
  return { ok: true, value: { materializedBytes, decodedFontBytes, decodedPixels } };
}

function validateTimeClaimQuota(input: WebCaptureEnvelopeInput): WebCaptureFailure | null {
  if (
    input.claims.time.kind === "finite-local-media" &&
    !withinWebCaptureBudget("mediaDurationMs", input.claims.time.durationMs)
  ) {
    return quotaFailure(
      "budget.media-duration-ms",
      input.claims.time.durationMs,
      WEB_CAPTURE_BUDGETS.mediaDurationMs,
    );
  }
  return null;
}

function validateResourceTotals(totals: ResourceTotals): WebCaptureFailure | null {
  const { materializedBytes, decodedFontBytes, decodedPixels } = totals;
  if (!withinWebCaptureBudget("materializedBytes", materializedBytes)) {
    return quotaFailure(
      "budget.materialized-bytes",
      materializedBytes,
      WEB_CAPTURE_BUDGETS.materializedBytes,
    );
  }
  if (!withinWebCaptureBudget("decodedFontBytes", decodedFontBytes)) {
    return quotaFailure(
      "budget.decoded-font-bytes",
      decodedFontBytes,
      WEB_CAPTURE_BUDGETS.decodedFontBytes,
    );
  }
  if (!withinWebCaptureBudget("aggregateDecodedPixels", decodedPixels)) {
    return quotaFailure(
      "budget.aggregate-decoded-pixels",
      decodedPixels,
      WEB_CAPTURE_BUDGETS.aggregateDecodedPixels,
    );
  }
  return null;
}

export function validateWebCaptureQuotas(input: WebCaptureEnvelopeInput): WebCaptureFailure | null {
  const collectionFailure = validateCollectionQuotas(input);
  if (collectionFailure) return collectionFailure;
  const artifactFailure = validateArtifactQuota(input);
  if (artifactFailure) return artifactFailure;
  const rasterFailure = validateRasterQuotas(input);
  if (rasterFailure) return rasterFailure;
  const measured = measureResources(input);
  if (!measured.ok) return measured;
  const timeFailure = validateTimeClaimQuota(input);
  if (timeFailure) return timeFailure;
  return validateResourceTotals(measured.value);
}
