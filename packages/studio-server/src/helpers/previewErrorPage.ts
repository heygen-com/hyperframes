import {
  refusedPreviewMessage,
  STUDIO_PREVIEW_ERRORS,
} from "@hyperframes/core/studio-preview-mark";

const htmlText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function previewRefusalPage(message: string): string {
  const script = JSON.stringify(message).replace(/</g, "\\u003c");
  return `<!doctype html><meta charset="utf-8"><script>window.${STUDIO_PREVIEW_ERRORS}=[${script}]</script><p>${htmlText(message)}</p>`;
}

export function previewErrorPage(status: number): string {
  return previewRefusalPage(refusedPreviewMessage(status));
}
