import { normalizeErrorMessage } from "./utils/errorMessage.js";

const RENDER_SETUP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const RESULT_PREFIX = "HYPERFRAMES_RENDER_SETUP_RESULT:";

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

interface SetupOutput {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}

// The parent shows a failed worker's stderr as the error, so write the reason, not Node's crash dump.
export async function runRenderSetupStep(
  step: () => Promise<unknown>,
  output: SetupOutput,
): Promise<number> {
  try {
    output.stdout.write(RESULT_PREFIX + JSON.stringify(await step()) + "\n");
    return 0;
  } catch (error) {
    output.stderr.write(normalizeErrorMessage(error) + "\n");
    return 1;
  }
}
