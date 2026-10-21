export const MAX_OPEN_MEDIA_RANGE_BYTES = 4 * 1024 * 1024;

const isMedia = (contentType: string): boolean => /^(audio|video)\//i.test(contentType);

export function openRangeEnd(start: number, last: number, contentType: string): number {
  return isMedia(contentType) ? Math.min(last, start + MAX_OPEN_MEDIA_RANGE_BYTES - 1) : last;
}
