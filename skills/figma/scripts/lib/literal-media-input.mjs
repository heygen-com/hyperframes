// The standalone twin of assertLiteralMediaInput in packages/parsers/src/literalMediaInput.ts, for inputs and outputs; a test keeps them equal.
const PATTERN_IMAGE2_EXPANDS = /%\d*[d%*?[\]{}]/;
// With one of these anywhere in the path, ffmpeg reads any "%" in it as a pattern and can open a shorter name.
const PATTERN_WILDCARD = /[*?[{]/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** ffmpeg's image2 reader or writer would use other files, folders included, than the one named. */
export function assertLiteralMediaPath(input) {
  const local = !URL_SCHEME.test(input) || /^file:/i.test(input);
  const pattern =
    PATTERN_IMAGE2_EXPANDS.test(input) || (input.includes("%") && PATTERN_WILDCARD.test(input));
  if (!local || !pattern) return;
  throw new Error(
    `[FFmpeg] refused media path "${input.split(/[\\/]/).pop()}": a "%" followed by "d", another "%" or a wildcard, ` +
      'with or without digits between, or a "%" and a wildcard (*, ?, [ or {) anywhere in the path, would make ffmpeg ' +
      "read it as a pattern of other files. Rename the file or folder.",
  );
}
