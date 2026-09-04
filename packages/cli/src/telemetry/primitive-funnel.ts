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
  primitiveId: string;
  artifactId: string;
  versionId: string;
  catalogVersion: string;
  queryFingerprint: string;
}

type PrimitiveFunnelBaseProperties = {
  funnel_id: string;
  install_id: string;
  primitive_id: string;
  artifact_id: string;
  version_id: string;
  catalog_version: string;
  query_fingerprint: string;
};

type PrimitiveFunnelAuthState =
  | "anonymous"
  | "oauth_required"
  | "existing_session"
  | "oauth"
  | "authenticated";

/**
 * Single source of truth for canonical lifecycle side effects, stable event-id
 * suffixes, and each step's position in the canonical order.
 *
 * `step` exists because timestamps cannot express this order. Auth completion
 * and install start are emitted back to back inside one command and land in the
 * same millisecond, so ordering by timestamp resolves them arbitrarily and can
 * report an install that began before the auth that authorized it. Consumers
 * order by `funnel_step`; the terminal steps share no number with a step that
 * can co-occur, so ties are impossible rather than merely unlikely.
 *
 * Failure steps carry the number of the step they terminate, since a funnel
 * either reaches that step or fails at it. Never renumber a shipped step:
 * historical events keep the number they were emitted with.
 */
const PRIMITIVE_FUNNEL_SIDE_EFFECTS = {
  catalogSearched: { event: "primitive_catalog_searched", suffix: "catalog-searched", step: 1 },
  catalogResultSelected: {
    event: "primitive_catalog_result_selected",
    suffix: "catalog-result-selected",
    step: 2,
  },
  authStarted: { event: "primitive_auth_started", suffix: "auth-started", step: 3 },
  authCompleted: { event: "primitive_auth_completed", suffix: "auth-completed", step: 4 },
  authFailed: { event: "primitive_auth_failed", suffix: "auth-failed", step: 4 },
  installStarted: { event: "primitive_install_started", suffix: "install-started", step: 5 },
  installCompleted: { event: "primitive_install_completed", suffix: "install-completed", step: 6 },
  installFailed: { event: "primitive_install_failed", suffix: "install-failed", step: 6 },
  previewSucceeded: { event: "primitive_preview_succeeded", suffix: "preview", step: 7 },
  previewFailed: { event: "primitive_preview_failed", suffix: "preview", step: 7 },
  renderSucceeded: { event: "primitive_render_succeeded", suffix: "render", step: 8 },
  renderFailed: { event: "primitive_render_failed", suffix: "render", step: 8 },
} as const;

type PrimitiveFunnelSideEffect =
  (typeof PRIMITIVE_FUNNEL_SIDE_EFFECTS)[keyof typeof PRIMITIVE_FUNNEL_SIDE_EFFECTS];

const MAX_RESULT_COUNT = 1_000;
const MAX_DURATION_MS = 86_400_000;

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return value < 0 ? minimum : maximum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/** Privacy-safe telemetry for one catalog-selection lifecycle. */
export class PrimitiveFunnel {
  readonly #base: PrimitiveFunnelBaseProperties;
  readonly #terminalEventIds = new Set<string>();
  #identified = false;

  constructor(context: PrimitiveFunnelContext) {
    this.#base = {
      funnel_id: context.funnelId,
      install_id: context.installId,
      primitive_id: context.primitiveId,
      artifact_id: context.artifactId,
      version_id: context.versionId,
      catalog_version: context.catalogVersion,
      query_fingerprint: context.queryFingerprint,
    };
  }

  catalogSearched(resultCount: number): void {
    this.#track(PRIMITIVE_FUNNEL_SIDE_EFFECTS.catalogSearched, {
      result_count: boundedInteger(resultCount, 0, MAX_RESULT_COUNT),
      auth_state: "anonymous",
    });
  }

  catalogResultSelected(resultRank: number): void {
    this.#track(PRIMITIVE_FUNNEL_SIDE_EFFECTS.catalogResultSelected, {
      result_rank: boundedInteger(resultRank, 1, MAX_RESULT_COUNT),
      auth_state: "anonymous",
    });
  }

  authStarted(): void {
    this.#track(PRIMITIVE_FUNNEL_SIDE_EFFECTS.authStarted, {
      auth_state: "oauth_required",
    });
  }

  authCompleted(
    accountId: string | undefined,
    authState: "existing_session" | "oauth",
    durationMs: number,
  ): void {
    if (!shouldTrack() || this.#identified) return;
    this.#identified = true;
    const properties = {
      ...this.#base,
      event_id: `${this.#base.funnel_id}:${PRIMITIVE_FUNNEL_SIDE_EFFECTS.authCompleted.suffix}`,
      funnel_step: PRIMITIVE_FUNNEL_SIDE_EFFECTS.authCompleted.step,
      auth_state: authState,
      duration_ms: boundedInteger(durationMs, 0, MAX_DURATION_MS),
    };
    if (accountId) {
      trackEvent(
        "$identify",
        { ...properties, $anon_distinct_id: readConfig().anonymousId },
        accountId,
      );
    }
    trackEvent(PRIMITIVE_FUNNEL_SIDE_EFFECTS.authCompleted.event, properties);
  }

  authFailed(eventId: string, errorCode: PrimitiveFunnelErrorCode, durationMs: number): void {
    this.#trackTerminal(
      PRIMITIVE_FUNNEL_SIDE_EFFECTS.authFailed,
      eventId,
      "oauth_required",
      durationMs,
      errorCode,
    );
  }

  installStarted(): void {
    this.#track(PRIMITIVE_FUNNEL_SIDE_EFFECTS.installStarted, {
      auth_state: "authenticated",
    });
  }

  installCompleted(eventId: string, durationMs: number): void {
    this.#trackTerminal(
      PRIMITIVE_FUNNEL_SIDE_EFFECTS.installCompleted,
      eventId,
      "authenticated",
      durationMs,
    );
  }

  installFailed(eventId: string, errorCode: PrimitiveFunnelErrorCode, durationMs: number): void {
    this.#trackTerminal(
      PRIMITIVE_FUNNEL_SIDE_EFFECTS.installFailed,
      eventId,
      "authenticated",
      durationMs,
      errorCode,
    );
  }

  previewSucceeded(eventId: string, durationMs: number): void {
    this.#trackTerminal(
      PRIMITIVE_FUNNEL_SIDE_EFFECTS.previewSucceeded,
      eventId,
      "authenticated",
      durationMs,
    );
  }

  previewFailed(eventId: string, errorCode: PrimitiveFunnelErrorCode, durationMs: number): void {
    this.#trackTerminal(
      PRIMITIVE_FUNNEL_SIDE_EFFECTS.previewFailed,
      eventId,
      "authenticated",
      durationMs,
      errorCode,
    );
  }

  renderSucceeded(eventId: string, durationMs: number): void {
    this.#trackTerminal(
      PRIMITIVE_FUNNEL_SIDE_EFFECTS.renderSucceeded,
      eventId,
      "authenticated",
      durationMs,
    );
  }

  renderFailed(eventId: string, errorCode: PrimitiveFunnelErrorCode, durationMs: number): void {
    this.#trackTerminal(
      PRIMITIVE_FUNNEL_SIDE_EFFECTS.renderFailed,
      eventId,
      "authenticated",
      durationMs,
      errorCode,
    );
  }

  #track(sideEffect: PrimitiveFunnelSideEffect, properties: Record<string, string | number>): void {
    if (!shouldTrack()) return;
    trackEvent(sideEffect.event, {
      ...this.#base,
      event_id: `${this.#base.funnel_id}:${sideEffect.suffix}`,
      funnel_step: sideEffect.step,
      ...properties,
    });
  }

  #trackTerminal(
    sideEffect: PrimitiveFunnelSideEffect,
    eventId: string,
    authState: PrimitiveFunnelAuthState,
    durationMs: number,
    errorCode?: PrimitiveFunnelErrorCode,
  ): void {
    if (!shouldTrack() || this.#terminalEventIds.has(eventId)) return;
    this.#terminalEventIds.add(eventId);
    trackEvent(sideEffect.event, {
      ...this.#base,
      event_id: eventId,
      funnel_step: sideEffect.step,
      auth_state: authState,
      duration_ms: boundedInteger(durationMs, 0, MAX_DURATION_MS),
      ...(errorCode ? { error_code: errorCode } : {}),
    });
  }
}
