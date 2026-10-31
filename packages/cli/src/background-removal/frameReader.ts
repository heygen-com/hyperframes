/** Whole frames from a raw-video pipe: each chunk is copied once, into the frame it belongs to. */
export async function* readFrames(
  stream: NodeJS.ReadableStream,
  frameBytes: number,
): AsyncGenerator<Buffer> {
  let frame: Buffer | undefined;
  let filled = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let at = 0;
    while (at < chunk.length) {
      frame ??= Buffer.allocUnsafe(frameBytes);
      const take = Math.min(frameBytes - filled, chunk.length - at);
      chunk.copy(frame, filled, at, at + take);
      filled += take;
      at += take;
      if (filled === frameBytes) {
        const whole = frame;
        frame = undefined;
        filled = 0;
        yield whole;
      }
    }
  }
}
