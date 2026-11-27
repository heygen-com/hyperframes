import { RUNTIME_BOOTSTRAP_ATTR } from "@hyperframes/core/compiler";
import {
  refusedPreviewMessage,
  STUDIO_PREVIEW_ERRORS,
} from "@hyperframes/core/studio-preview-mark";

const htmlText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const previewRuntimeTag = (runtimeUrl: string) =>
  `<script ${RUNTIME_BOOTSTRAP_ATTR}="1" src="${runtimeUrl}"></script>`;

export function previewRefusalPage(message: string, runtimeUrl: string): string {
  const script = JSON.stringify(message).replace(/</g, "\\u003c");
  return `<!doctype html><meta charset="utf-8"><script>window.${STUDIO_PREVIEW_ERRORS}=[${script}]</script>${previewRuntimeTag(runtimeUrl)}<p>${htmlText(message)}</p>`;
}

export function previewErrorPage(status: number, runtimeUrl: string): string {
  return previewRefusalPage(refusedPreviewMessage(status), runtimeUrl);
}
