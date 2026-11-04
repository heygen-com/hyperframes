/** Folders whose writes never reload Studio's preview, so nothing that judges a preview stale may count them. */
export const PREVIEW_IGNORED_DIRS: ReadonlySet<string> = new Set([
  ".cache",
  ".git",
  ".hyperframes",
  ".next",
  ".thumbnails",
  ".transcode-cache",
  ".vite",
  ".waveform-cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "outputs",
  "renders",
]);

export const RENDER_TEMP_DIR =
  /^(work-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|hf-render|\..+\.hf-transaction)-[A-Za-z0-9]{6}$/;

export const isProjectIgnoredDir = (name: string): boolean =>
  PREVIEW_IGNORED_DIRS.has(name) || RENDER_TEMP_DIR.test(name);
