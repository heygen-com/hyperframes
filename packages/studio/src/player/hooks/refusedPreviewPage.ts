import {
  refusedPreviewStatus,
  STUDIO_PREVIEW_ERRORS,
  STUDIO_PREVIEW_RETRY_AFTER,
} from "@hyperframes/core/studio-preview-mark";

const pageWindow = (iframe: HTMLIFrameElement | null) =>
  iframe?.contentWindow as Record<string, unknown> | null | undefined;

export function refusedPageMessage(iframe: HTMLIFrameElement | null): string | null {
  try {
    const errors = pageWindow(iframe)?.[STUDIO_PREVIEW_ERRORS];
    const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
    return typeof first === "string" && refusedPreviewStatus(first) !== null ? first : null;
  } catch {
    return null;
  }
}

export function pageRetryAfterMs(iframe: HTMLIFrameElement | null): number | undefined {
  try {
    const seconds = pageWindow(iframe)?.[STUDIO_PREVIEW_RETRY_AFTER];
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : undefined;
  } catch {
    return undefined;
  }
}
