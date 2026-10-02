const RENDER_SETUP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

type RenderSetupSignal = (typeof RENDER_SETUP_SIGNALS)[number];

interface SignalTarget {
  on(signal: RenderSetupSignal, handler: () => void): unknown;
  off(signal: RenderSetupSignal, handler: () => void): unknown;
}

export function installRenderSetupSignalHandlers(
  signalTarget: SignalTarget,
  releaseLock: () => void,
  resendSignal: (signal: RenderSetupSignal) => void,
  handleHangup = true,
): () => void {
  const handlers = new Map<RenderSetupSignal, () => void>();
  const handledSignals = handleHangup
    ? RENDER_SETUP_SIGNALS
    : RENDER_SETUP_SIGNALS.filter((signal) => signal !== "SIGHUP");
  for (const signal of handledSignals) {
    const handler = (): void => {
      releaseLock();
      signalTarget.off(signal, handler);
      resendSignal(signal);
    };
    handlers.set(signal, handler);
    signalTarget.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) signalTarget.off(signal, handler);
  };
}
