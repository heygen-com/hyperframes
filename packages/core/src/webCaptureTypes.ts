import type {
  WebCaptureDiagnostic,
  WebCaptureFailureCode,
  WebCaptureRejectionReason,
} from "./webCaptureDiagnostics";

export interface WebCaptureSourceFrameClaim {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export type WebCaptureTimeClaim =
  | { kind: "locked-frame"; atMs: number }
  | { kind: "finite-local-media"; durationMs: number; deterministicSeek: boolean };

export interface WebCaptureClaims {
  sourceFrame: WebCaptureSourceFrameClaim;
  time: WebCaptureTimeClaim;
  reflow: "fixed-viewport";
}

export type WebCaptureArtifact =
  | { kind: "editable-dom"; html: string; css: string; width: number; height: number }
  | { kind: "finite-local-media"; resourceId: string; width: number; height: number }
  | {
      kind: "still";
      resourceId: string;
      width: number;
      height: number;
      completeness: "complete" | "cropped";
    };

export type WebCaptureRepresentationDecision =
  | { kind: "editable-dom"; time: Extract<WebCaptureTimeClaim, { kind: "locked-frame" }> }
  | {
      kind: "finite-local-media";
      time: Extract<WebCaptureTimeClaim, { kind: "finite-local-media" }>;
    }
  | { kind: "still"; time: Extract<WebCaptureTimeClaim, { kind: "locked-frame" }> }
  | { kind: "rejected"; reason: WebCaptureRejectionReason; time: null };

interface WebCaptureResourceBase {
  id: string;
  bytes: number;
  sha256: string;
  data: string;
}

export type WebCaptureResource =
  | (WebCaptureResourceBase & {
      kind: "image";
      mime: "image/png" | "image/jpeg" | "image/webp";
      width: number;
      height: number;
    })
  | (WebCaptureResourceBase & {
      kind: "font";
      mime: "font/woff2";
      decodedBytes: number;
    })
  | (WebCaptureResourceBase & {
      kind: "media";
      mime: "video/webm" | "video/mp4";
      width: number;
      height: number;
      durationMs: number;
    })
  | (WebCaptureResourceBase & {
      kind: "model";
      mime: "model/gltf-binary";
    });

export interface WebCaptureResourceInspection {
  mime: WebCaptureResource["mime"];
  width?: number;
  height?: number;
  durationMs?: number;
  decodedBytes?: number;
}

export type WebCaptureResourceMaterializer = (
  bytes: Uint8Array,
  inspected: WebCaptureResourceInspection,
  signal: AbortSignal,
) => Promise<WebCaptureResourceInspection | null>;

export interface WebCaptureValidationOptions {
  materializeResource: WebCaptureResourceMaterializer;
  customMimeText?: string;
  signal?: AbortSignal;
}

export interface WebCaptureEnvelopeInput {
  artifact: WebCaptureArtifact;
  resources: WebCaptureResource[];
  diagnostics: WebCaptureDiagnostic[];
  claims: WebCaptureClaims;
}

export interface WebCaptureEnvelope extends WebCaptureEnvelopeInput {
  version: "2.0";
  audience: "hyperframes-studio";
  integrity: {
    algorithm: "SHA-256";
    scope: "canonical-envelope-without-integrity";
    digest: string;
  };
}

export type WebCaptureFailure =
  | {
      ok: false;
      code: Extract<WebCaptureFailureCode, "route.unrecognized" | "protocol.legacy-v1">;
    }
  | {
      ok: false;
      code: Extract<WebCaptureFailureCode, "protocol.unsupported-version">;
      version: string;
    }
  | {
      ok: false;
      code: Extract<
        WebCaptureFailureCode,
        "clipboard.mime-mismatch" | "grammar.malformed" | "grammar.non-canonical"
      >;
    }
  | { ok: false; code: Extract<WebCaptureFailureCode, "grammar.duplicate-key">; key: string }
  | {
      ok: false;
      code: Extract<WebCaptureFailureCode, "schema.unknown-key">;
      path: string;
      key: string;
    }
  | { ok: false; code: Extract<WebCaptureFailureCode, "schema.invalid">; path: string }
  | { ok: false; code: Extract<WebCaptureFailureCode, "schema.invalid-artifact"> }
  | {
      ok: false;
      code: Extract<WebCaptureFailureCode, `budget.${string}`>;
      actual: number;
      limit: number;
    }
  | {
      ok: false;
      code: Extract<WebCaptureFailureCode, "resource.duplicate-id" | "resource.hash-mismatch">;
      resourceId: string;
    }
  | {
      ok: false;
      code: Extract<
        WebCaptureFailureCode,
        | "resource.invalid-data"
        | "resource.mime-mismatch"
        | "resource.dimensions-mismatch"
        | "resource.decoded-size-mismatch"
        | "resource.duration-mismatch"
        | "resource.materialization-failed"
        | "resource.materialization-aborted"
      >;
      resourceId: string;
    }
  | { ok: false; code: Extract<WebCaptureFailureCode, "integrity.digest-mismatch"> };

export type WebCaptureBuildResult =
  | { ok: true; text: string; envelope: WebCaptureEnvelope }
  | WebCaptureFailure;

export type WebCaptureParseResult =
  | { ok: true; canonicalText: string; envelope: WebCaptureEnvelope }
  | WebCaptureFailure;
