import { assertLiteralMediaInput } from "@hyperframes/parsers/literal-media-input";

export const VIDEO_EXTS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".mpg",
  ".mpeg",
  ".ts",
  ".m2ts",
  ".mts",
  ".flv",
  ".wmv",
  ".ogv",
  ".3gp",
]);
export const AUDIO_EXTS = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".flac",
  ".aif",
  ".aiff",
  ".wma",
]);
// Still images the API refuses; converted to PNG unless animated.
export const CONVERTIBLE_IMAGE_EXTS = new Set([".gif", ".avif", ".bmp", ".tif", ".tiff"]);

export const NOT_MEDIA = "not a media file";

export const MEDIA_INPUT_ARGS: readonly string[] = [
  "-protocol_whitelist",
  "file",
  "-format_whitelist",
  "mov,matroska,mxf,avi,mpeg,mpegts,mpegvideo,flv,asf,ogg,wav,mp3,aac,flac,aiff,gif,image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe",
];

export function mediaInputArgs(input: string): readonly string[] {
  assertLiteralMediaInput(input);
  return MEDIA_INPUT_ARGS;
}

const PLAYLIST_START = /^(?:\xEF\xBB\xBF)?\s*(?:#EXTM3U|ffconcat)/;
const MARKUP_START = /^(?:\xEF\xBB\xBF)?\s*</;
export const isControlByte = (byte: number) => byte < 0x09 || (byte > 0x0d && byte < 0x20);

export function startsAsMediaPlaylist(head: Buffer): boolean {
  const text = head.toString("latin1");
  return PLAYLIST_START.test(text) || (MARKUP_START.test(text) && !head.some(isControlByte));
}
