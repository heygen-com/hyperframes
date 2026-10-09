import { normalizeErrorMessage } from "./utils/errorMessage.js";

const RENDER_SETUP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
export const RENDER_SETUP_RESULT_PREFIX = "HYPERFRAMES_RENDER_SETUP_RESULT:";
const RENDER_SETUP_ERROR_PREFIX = "HYPERFRAMES_RENDER_SETUP_ERROR:";

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

export function renderSetupErrorLine(error: unknown): string {
  return RENDER_SETUP_ERROR_PREFIX + JSON.stringify(normalizeErrorMessage(error)) + "\n";
}

export function renderSetupErrorFrom(stderr: string): string | undefined {
  const line = stderr.split(/\r?\n/).find((text) => text.startsWith(RENDER_SETUP_ERROR_PREFIX));
  return line === undefined ? undefined : JSON.parse(line.slice(RENDER_SETUP_ERROR_PREFIX.length));
}
