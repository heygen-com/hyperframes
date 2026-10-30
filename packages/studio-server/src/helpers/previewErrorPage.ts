import {
  refusedPreviewMessage,
  STUDIO_PREVIEW_ERRORS,
} from "@hyperframes/core/studio-preview-mark";

export function previewErrorPage(status: number): string {
  const message = refusedPreviewMessage(status);
  return `<!doctype html><meta charset="utf-8"><script>window.${STUDIO_PREVIEW_ERRORS}=[${JSON.stringify(message)}]</script><p>${message}</p>`;
}
