const PATTERN_IMAGE2_EXPANDS = /%\d*[d%*?[\]{}]/;
// With one of these anywhere in the path, ffmpeg reads any "%" in it as a pattern and can open a shorter name.
const PATTERN_WILDCARD = /[*?[{]/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

function refusePattern(path: string, use: "read" | "write"): void {
  const local = !URL_SCHEME.test(path) || /^file:/i.test(path);
  const pattern =
    PATTERN_IMAGE2_EXPANDS.test(path) || (path.includes("%") && PATTERN_WILDCARD.test(path));
  if (!local || !pattern) return;
  throw new Error(
    `[FFmpeg] refused media path "${path.split(/[\\/]/).pop()}": a "%" followed by "d", another "%" or a wildcard, ` +
      `with or without digits between, or a "%" and a wildcard (*, ?, [ or {) anywhere in the path, would make ffmpeg ` +
      `${use} it as a pattern of other files. Rename the file or folder.`,
  );
}

/** ffmpeg's image2 demuxer would open other files, folders included, than the one a project check approved. */
export function assertLiteralMediaInput(input: string): void {
  refusePattern(input, "read");
}

export function assertLiteralMediaOutput(output: string): void {
  refusePattern(output, "write");
}
