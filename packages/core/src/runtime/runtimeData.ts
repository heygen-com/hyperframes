export type RuntimeDataHandler = (payload: unknown) => void;
export type RuntimeDataErrorReporter = (channel: string, error: unknown) => void;

const retained = new Map<string, unknown>();
const handlers = new Map<string, RuntimeDataHandler>();
let reportError: RuntimeDataErrorReporter = () => undefined;

function validChannel(channel: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(channel);
}

function deliver(channel: string, payload: unknown): void {
  const handler = handlers.get(channel);
  if (!handler) return;
  try {
    handler(payload);
  } catch (error) {
    reportError(channel, error);
  }
}

export function setRuntimeDataErrorReporter(reporter: RuntimeDataErrorReporter): void {
  reportError = reporter;
}

export function setRuntimeData(channel: string, payload: unknown): void {
  if (!validChannel(channel)) return;
  retained.set(channel, payload);
  deliver(channel, payload);
}

export function clearRuntimeData(channel: string): void {
  if (!validChannel(channel)) return;
  retained.delete(channel);
  deliver(channel, undefined);
}

export function registerRuntimeDataHandler(
  channel: string,
  handler: RuntimeDataHandler,
): () => void {
  if (!validChannel(channel))
    throw new Error(`Invalid HyperFrames runtime-data channel: ${channel}`);
  handlers.set(channel, handler);
  if (retained.has(channel)) deliver(channel, retained.get(channel));
  return () => {
    if (handlers.get(channel) === handler) handlers.delete(channel);
  };
}

export function resetRuntimeDataForTests(): void {
  retained.clear();
  handlers.clear();
  reportError = () => undefined;
}
