import { RUNTIME_BOOTSTRAP_ATTR } from "@hyperframes/core/compiler";
import {
  refusedPreviewMessage,
  STUDIO_PREVIEW_ERRORS,
  STUDIO_PREVIEW_RETRY_AFTER,
} from "@hyperframes/core/studio-preview-mark";

const htmlText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const previewRuntimeTag = (runtimeUrl: string) =>
  `<script ${RUNTIME_BOOTSTRAP_ATTR}="1" src="${runtimeUrl}"></script>`;

export function previewRefusalPage(
  message: string,
  runtimeUrl: string,
  retryAfterS?: number,
): string {
  const script = JSON.stringify(message).replace(/</g, "\\u003c");
  const retry =
    retryAfterS === undefined ? "" : `window.${STUDIO_PREVIEW_RETRY_AFTER}=${retryAfterS};`;
  return `<!doctype html><meta charset="utf-8"><script>window.${STUDIO_PREVIEW_ERRORS}=[${script}];${retry}</script>${previewRuntimeTag(runtimeUrl)}<p>${htmlText(message)}</p>`;
}

export function retryAfterSeconds(header: string | null): number | undefined {
  return header !== null && /^\d{1,4}$/.test(header.trim()) ? Number(header.trim()) : undefined;
}

export function previewErrorPage(status: number, runtimeUrl: string, retryAfterS?: number): string {
  return previewRefusalPage(refusedPreviewMessage(status), runtimeUrl, retryAfterS);
}
