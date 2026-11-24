// The standalone twin of assertLiteralMediaInput in packages/parsers/src/literalMediaInput.ts, for inputs and outputs; a test keeps them equal.
const PATTERN_IMAGE2_EXPANDS = /%\d*[d%*?[\]{}]/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** ffmpeg's image2 reader or writer would use other files, folders included, than the one named. */
export function assertLiteralMediaPath(input) {
  const local = !URL_SCHEME.test(input) || /^file:/i.test(input);
  if (!local || !PATTERN_IMAGE2_EXPANDS.test(input)) return;
  throw new Error(
    `[FFmpeg] refused media path "${input.split(/[\\/]/).pop()}": a "%" followed by "d", another "%" or a wildcard, ` +
      "with or without digits between, would make ffmpeg read it as a pattern of other files. Rename the file or folder.",
  );
}
