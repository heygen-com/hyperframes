// @ts-check
/** @param {string} path */
const pathParts = (path) => path.split(/[\\/]/);
export const APP_OWNED_DIRS = [
  ".thumbnails",
  ".hyperframes",
  ".claude",
  "renders",
  ".transcode-cache",
  ".waveform-cache",
];

/** True for a project-relative path that lives under one of the app's own folders. @param {string} relativePath */
export const isAppOwned = (relativePath) =>
  APP_OWNED_DIRS.includes(/** @type {string} */ (pathParts(relativePath)[0]));

/** A file the film can never load, so no change report counts it: the app's own folders, anything hidden
 * (a dot file or folder: .git, .DS_Store), installed packages, and temporary editor or download files.
 * @param {string} relativePath */
export function isOutsideFilm(relativePath) {
  const parts = pathParts(relativePath);
  return (
    isAppOwned(relativePath) ||
    parts.some((part) => part.startsWith(".") || part === "node_modules") ||
    /(?:~|\.swp|\.tmp|\.part)$/.test(parts.at(-1) ?? "")
  );
}
