import { STUDIO_PREVIEW_ERRORS } from "@hyperframes/core/studio-preview-mark";

export function previewErrorPage(status: number): string {
  const message = `The preview page could not be loaded (HTTP ${status}).`;
  return `<!doctype html><meta charset="utf-8"><script>window.${STUDIO_PREVIEW_ERRORS}=[${JSON.stringify(message)}]</script><p>${message}</p>`;
}
