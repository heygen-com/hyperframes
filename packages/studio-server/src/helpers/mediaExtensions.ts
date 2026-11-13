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
