const PREFIX = "appifact-film:";

export interface FilmBridge {
  ready: Promise<void>;
  render: (time: number) => Promise<void>;
  dispose: () => void;
}

/** Install the listener before loading the preserved runner into its opaque sandbox. */
export function createFilmBridge(options: {
  iframe: HTMLIFrameElement;
  runnerHtml: string;
  load: Record<string, unknown>;
}): FilmBridge {
  const { iframe, runnerHtml, load } = options;
  const permissions = (iframe.getAttribute("sandbox") ?? "").split(/\s+/);
  if (!permissions.includes("allow-scripts") || permissions.includes("allow-same-origin")) {
    throw new Error('Film runners require sandbox="allow-scripts" without allow-same-origin');
  }
  let sequence = 0;
  let loaded = false;
  let disposed = false;
  let failure: Error | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  let pending: {
    sequence: number;
    resolve: () => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const fail = (error: Error) => {
    failure = error;
    clearTimeout(startupTimer);
    rejectReady(error);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = null;
    }
  };
  const startupTimer = setTimeout(
    () => fail(new Error("Film runner did not become ready within 20 s")),
    20_000,
  );
  const completeFrame = (data: { type: unknown }) => {
    if (
      (data.type !== PREFIX + "frame" && data.type !== PREFIX + "frame-error") ||
      !("seq" in data) ||
      pending === null ||
      pending.sequence !== data.seq
    )
      return;
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    if (data.type === PREFIX + "frame-error") {
      request.reject(new Error("message" in data ? String(data.message) : "Film frame failed"));
    } else request.resolve();
  };
  const receiveStartup = (data: { type: unknown }) => {
    if (data.type === PREFIX + "hello" && !loaded) {
      loaded = true;
      iframe.contentWindow?.postMessage({ ...load, type: PREFIX + "load" }, "*");
    } else if (data.type === PREFIX + "ready" && loaded) {
      clearTimeout(startupTimer);
      resolveReady();
    } else if (data.type === PREFIX + "error") {
      fail(new Error("message" in data ? String(data.message) : "Film runner failed"));
    }
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (disposed || failure || event.source !== iframe.contentWindow || event.origin !== "null") {
      return;
    }
    const data = event.data;
    if (!data || typeof data !== "object" || !("type" in data)) return;
    receiveStartup(data);
    completeFrame(data);
  };
  window.addEventListener("message", receive);
  iframe.srcdoc = runnerHtml;
  return {
    ready,
    async render(time) {
      await ready;
      if (failure) throw failure;
      if (pending) throw new Error("Film seeks must be serialized; use registerFrameSource");
      const seq = ++sequence;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          fail(new Error("Film frame did not arrive within 15 s"));
        }, 15_000);
        pending = { sequence: seq, resolve, reject, timer };
        iframe.contentWindow?.postMessage({ type: PREFIX + "frame", t: time, seq }, "*");
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("message", receive);
      fail(new Error("Film bridge was disposed"));
    },
  };
}
