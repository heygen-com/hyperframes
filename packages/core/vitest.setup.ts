Object.defineProperty(navigator, "userAgent", {
  configurable: true,
  get: () =>
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
});

// jsdom loads no media. A detached element's header read (core audioDecode.ts) answers
// mediaHeaderSeconds(url): one minute unless a test stubs it; null answers as unreadable.
(globalThis as Record<string, unknown>).mediaHeaderSeconds = (): number | null => 60;
if (typeof HTMLMediaElement !== "undefined") {
  const loadMedia = HTMLMediaElement.prototype.load;
  HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
    const src = this.getAttribute("src");
    if (this.isConnected || !src) return loadMedia.call(this);
    const read = globalThis as unknown as { mediaHeaderSeconds: (url: string) => number | null };
    const seconds = read.mediaHeaderSeconds(src);
    if (seconds !== null)
      Object.defineProperty(this, "duration", { configurable: true, value: seconds });
    queueMicrotask(() =>
      this.dispatchEvent(new Event(seconds === null ? "error" : "loadedmetadata")),
    );
  };
}
