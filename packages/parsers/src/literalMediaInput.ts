const PATTERN_IMAGE2_EXPANDS = /%(?:\d*d|[%*?[\]{}])/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** ffmpeg's image2 demuxer would open other files, folders included, than the one a project check approved. */
export function assertLiteralMediaInput(input: string): void {
  const local = !URL_SCHEME.test(input) || /^file:/i.test(input);
  if (!local || !PATTERN_IMAGE2_EXPANDS.test(input)) return;
  throw new Error(
    `[FFmpeg] refused media path "${input.split(/[\\/]/).pop()}": a "%" followed by a number and "d", ` +
      'another "%" or a wildcard would make ffmpeg read it as a pattern of other files. Rename the file or folder.',
  );
}
