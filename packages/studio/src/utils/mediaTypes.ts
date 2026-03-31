export const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i;
export const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
export const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac)$/i;
export const FONT_EXT = /\.(woff|woff2|ttf|otf|eot)$/i;
export const MEDIA_EXT = /\.(mp4|webm|mov|mp3|wav|ogg|m4a|aac|jpg|jpeg|png|gif|webp|svg|ico)$/i;

export function isMediaFile(path: string): boolean {
  return MEDIA_EXT.test(path);
}
