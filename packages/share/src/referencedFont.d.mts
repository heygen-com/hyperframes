/** Serve a dot-prefixed font selected by the current project dependency scan. */
export function referencedFontResponse(
  projectDir: string,
  requested: string | URL,
  method: string,
): Promise<Response | null>;
