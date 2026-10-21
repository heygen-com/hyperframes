/**
 * The most bytes an open-ended media range (`Range: bytes=N-`) is answered with.
 *
 * A media element asks for `bytes=N-`, reads until its buffer is full, then stops reading and
 * leaves the response open. Answered to EOF, every <video>/<audio> holds one of the browser's six
 * HTTP/1.1 connections to the host for as long as the page is open. A composition with more than
 * about six media clips on one host (a long recording cut into trimmed segments, each its own
 * <video> on the same file) then leaves every other request queued, and `hyperframes check` stalls
 * at 0% CPU. A bounded answer completes and frees its connection, and the element asks for the
 * next range as it plays or seeks. See heygen-com/hyperframes#6029 for a repro.
 */
export const OPEN_MEDIA_RANGE_BYTES = 4 * 1024 * 1024;

/**
 * The last byte to send for `bytes=start-` of a file whose last byte is `last`: the rest of the
 * file, except for audio and video, which get at most OPEN_MEDIA_RANGE_BYTES.
 */
export function openRangeEnd(start: number, last: number, contentType: string): number {
  return /^(audio|video)\//i.test(contentType)
    ? Math.min(last, start + OPEN_MEDIA_RANGE_BYTES - 1)
    : last;
}
