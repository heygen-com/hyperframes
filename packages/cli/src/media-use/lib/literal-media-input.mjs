// The standalone twin of assertLiteralMediaInput in packages/parsers/src/literalMediaInput.ts, for inputs and outputs,
// and of the parsers' self-contained reader list; tests keep both equal.
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

// Containers that hold their own media and name no other file. A file read with only these, over the file
// protocol, cannot be a list, playlist, manifest, script or text-art reader that opens what it names.
export const SELF_CONTAINED_FORMATS =
  "mov,matroska,mxf,avi,mpeg,mpegts,mpegvideo,flv,asf,ogg,wav,mp3,aac,flac,aiff,caf,w64,wv,au,ac3,gif,ico,image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe";

/** ffmpeg or ffprobe options, placed before the file, that read it as one local self-contained container. */
export function selfContainedInput(file) {
  assertLiteralMediaPath(file);
  return ["-protocol_whitelist", "file", "-format_whitelist", SELF_CONTAINED_FORMATS];
}

/** ffmpeg options that read `list` as a concat list of local parts, each opened only as `reader`, which wrote them. */
export function partsListInput(list, reader) {
  if (!SELF_CONTAINED_FORMATS.split(",").includes(reader))
    throw new Error(`not a self-contained reader: ${reader}`);
  const readers = `concat,${reader}`;
  return [
    "-protocol_whitelist",
    "file",
    "-format_whitelist",
    readers,
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
  ];
}
