import { shouldTrack, trackEvent } from "./client.js";
import { readConfig } from "./config.js";

export type PrimitiveFunnelErrorCode =
  | "invalid_payload"
  | "auth_failed"
  | "auth_cancelled"
  | "install_failed"
  | "preview_failed"
  | "compile_failed"
  | "capture_failed"
  | "render_failed";

export interface PrimitiveFunnelContext {
  funnelId: string;
  installId: string;
  artifactId: string;
  versionId: string;
  catalogVersion: string;
  queryFingerprint: string;
}

type PrimitiveFunnelBaseProperties = {
  funnel_id: string;
  install_id: string;
  artifact_id: string;
  version_id: string;
  catalog_version: string;
  query_fingerprint: string;
};

/** Privacy-safe telemetry for one catalog-selection lifecycle. */
export class PrimitiveFunnel {
  readonly #base: PrimitiveFunnelBaseProperties;
  readonly #terminalEventIds = new Set<string>();
  #identified = false;

  constructor(context: PrimitiveFunnelContext) {
    this.#base = {
      funnel_id: context.funnelId,
      install_id: context.installId,
      artifact_id: context.artifactId,
      version_id: context.versionId,
      catalog_version: context.catalogVersion,
      query_fingerprint: context.queryFingerprint,
    };
  }

  searched(): void {
    this.#track("primitive_searched");
  }

  selected(): void {
    this.#track("primitive_selected");
  }

  authRequired(): void {
    this.#track("primitive_auth_required");
  }

  authCompleted(accountId?: string): void {
    if (!shouldTrack() || this.#identified) return;
    this.#identified = true;
    if (accountId) {
      trackEvent(
        "$identify",
        { ...this.#base, $anon_distinct_id: readConfig().anonymousId },
        accountId,
      );
    }
    trackEvent("primitive_auth_completed", this.#base);
  }

  installSucceeded(eventId: string): void {
    this.#trackTerminal("primitive_install_succeeded", eventId);
  }

  installFailed(eventId: string, errorCode: PrimitiveFunnelErrorCode): void {
    this.#trackTerminal("primitive_install_failed", eventId, errorCode);
  }

  previewSucceeded(eventId: string): void {
    this.#trackTerminal("primitive_preview_succeeded", eventId);
  }

  previewFailed(eventId: string, errorCode: PrimitiveFunnelErrorCode): void {
    this.#trackTerminal("primitive_preview_failed", eventId, errorCode);
  }

  renderSucceeded(eventId: string): void {
    this.#trackTerminal("primitive_render_succeeded", eventId);
  }

  renderFailed(eventId: string, errorCode: PrimitiveFunnelErrorCode): void {
    this.#trackTerminal("primitive_render_failed", eventId, errorCode);
  }

  #track(name: string): void {
    if (!shouldTrack()) return;
    trackEvent(name, this.#base);
  }

  #trackTerminal(name: string, eventId: string, errorCode?: PrimitiveFunnelErrorCode): void {
    if (!shouldTrack() || this.#terminalEventIds.has(eventId)) return;
    this.#terminalEventIds.add(eventId);
    trackEvent(name, {
      ...this.#base,
      event_id: eventId,
      ...(errorCode ? { error_code: errorCode } : {}),
    });
  }
}
