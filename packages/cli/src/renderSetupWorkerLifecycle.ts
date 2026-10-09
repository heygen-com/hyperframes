import { normalizeErrorMessage } from "./utils/errorMessage.js";

const RENDER_SETUP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const RENDER_SETUP_RESULT_PREFIX = "HYPERFRAMES_RENDER_SETUP_RESULT:";
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

function prefixedLine(prefix: string, value: unknown): string {
  return prefix + JSON.stringify(value) + "\n";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function prefixedValue(output: string, prefix: string): unknown {
  const line = output.split(/\r?\n/).find((text) => text.startsWith(prefix));
  return line === undefined ? undefined : parseJson(line.slice(prefix.length));
}

export function renderSetupResultLine(result: unknown): string {
  return prefixedLine(RENDER_SETUP_RESULT_PREFIX, result);
}

export function renderSetupResultFrom(stdout: string): unknown {
  return prefixedValue(stdout, RENDER_SETUP_RESULT_PREFIX);
}

export function renderSetupErrorLine(error: unknown): string {
  return "\n" + prefixedLine(RENDER_SETUP_ERROR_PREFIX, normalizeErrorMessage(error));
}

export function renderSetupFailureFrom(
  stderr: string,
): { reason: string; earlierOutput: string } | undefined {
  const lines = stderr.split(/\r?\n/);
  const at = lines.findIndex((text) => text.startsWith(RENDER_SETUP_ERROR_PREFIX));
  const reason =
    at === -1 ? undefined : parseJson(lines[at]!.slice(RENDER_SETUP_ERROR_PREFIX.length));
  if (typeof reason !== "string" || reason === "") return undefined;
  return { reason, earlierOutput: lines.slice(0, at).join("\n") };
}
