// The standalone twin of assertLiteralMediaInput in packages/parsers/src/literalMediaInput.ts, for inputs and outputs; a test keeps them equal.
const PATTERN_IMAGE2_EXPANDS = /%\d*[d%*?[\]{}]/;
const WILDCARD_MAKES_ANY_PERCENT_A_PATTERN = /[*?[{]/;
const FORWARDED = /^https?:/i;

/** ffmpeg's image2 reader or writer would use other files, folders included, than the one named. */
export function assertLiteralMediaPath(input) {
  const pattern =
    PATTERN_IMAGE2_EXPANDS.test(input) ||
    (input.includes("%") && WILDCARD_MAKES_ANY_PERCENT_A_PATTERN.test(input));
  if (FORWARDED.test(input) || !pattern) return;
  throw new Error(
    `[FFmpeg] refused media path "${input.split(/[\\/]/).pop()}": a "%" followed by "d", another "%" or a wildcard, ` +
      'with or without digits between, or a "%" and a wildcard (*, ?, [ or {) anywhere in the path, would make ffmpeg ' +
      "read it as a pattern of other files. Rename the file or folder.",
  );
}
