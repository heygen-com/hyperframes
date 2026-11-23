if (typeof globalThis.CSS === "undefined") {
  (globalThis as Record<string, unknown>).CSS = {};
}
if (typeof CSS.escape !== "function") {
  CSS.escape = (value: string) => value.replace(/([^\w-])/g, "\\$1");
}

// happy-dom does not implement `window.confirm`. Vitest 3 let `vi.spyOn` invent
// a missing property; Vitest 4 refuses with "can only spy on a function", so the
// environment has to supply a real one for the guard tests to replace. Declining
// is the safe default: no test calls it without stubbing a return value first.
if (typeof globalThis.confirm !== "function") {
  (globalThis as Record<string, unknown>).confirm = () => false;
}

(globalThis as Record<string, unknown>).BASE_UI_ANIMATIONS_DISABLED = true;

// The DOM under test loads no media. A detached element's header read (core audioDecode.ts) answers
// mediaHeaderSeconds(url): one minute unless a test stubs it; null answers as unreadable.
(globalThis as Record<string, unknown>).mediaHeaderSeconds = (): number | null => 60;
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
