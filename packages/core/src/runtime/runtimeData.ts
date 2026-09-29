export type RuntimeDataHandler = (payload: unknown) => void | Promise<void>;
export type RuntimeDataErrorReporter = (channel: string, requestId: number, error: unknown) => void;
export type RuntimeDataAppliedReporter = (channel: string, requestId: number) => void;

type RetainedRuntimeData = {
  payload: unknown;
  requestId: number;
  generation: number;
};

const retained = new Map<string, RetainedRuntimeData>();
const handlers = new Map<string, RuntimeDataHandler>();
const generations = new Map<string, number>();
let reportError: RuntimeDataErrorReporter = () => undefined;
let reportApplied: RuntimeDataAppliedReporter = () => undefined;
let localRequestId = 0;

function validChannel(channel: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(channel);
}

function nextGeneration(channel: string): number {
  const generation = (generations.get(channel) ?? 0) + 1;
  generations.set(channel, generation);
  return generation;
}

function resolveRequestId(requestId: number | undefined): number {
  if (typeof requestId === "number" && Number.isSafeInteger(requestId) && requestId > 0)
    return requestId;
  // Guest-local ids count down so they can never collide with a host id, which is
  // required above to be positive. A shared id space lets a composition-side call
  // report `applied` under a host request's id while that host payload is still in flight.
  localRequestId -= 1;
  return localRequestId;
}

function deliver(channel: string, retainedData: RetainedRuntimeData): void {
  const handler = handlers.get(channel);
  if (!handler) return;
  const isCurrent = () =>
    generations.get(channel) === retainedData.generation && handlers.get(channel) === handler;
  try {
    void Promise.resolve(handler(retainedData.payload)).then(
      () => {
        if (isCurrent()) reportApplied(channel, retainedData.requestId);
      },
      (error) => {
        if (isCurrent()) reportError(channel, retainedData.requestId, error);
      },
    );
  } catch (error) {
    if (isCurrent()) reportError(channel, retainedData.requestId, error);
  }
}

export function setRuntimeDataErrorReporter(reporter: RuntimeDataErrorReporter): void {
  reportError = reporter;
}

export function setRuntimeDataAppliedReporter(reporter: RuntimeDataAppliedReporter): void {
  reportApplied = reporter;
}

export function setRuntimeData(channel: string, payload: unknown, requestId?: number): void {
  if (!validChannel(channel)) return;
  const retainedData = {
    payload,
    requestId: resolveRequestId(requestId),
    generation: nextGeneration(channel),
  };
  retained.set(channel, retainedData);
  deliver(channel, retainedData);
}

export function clearRuntimeData(channel: string, requestId?: number): void {
  if (!validChannel(channel)) return;
  retained.delete(channel);
  deliver(channel, {
    payload: undefined,
    requestId: resolveRequestId(requestId),
    generation: nextGeneration(channel),
  });
}

export function registerRuntimeDataHandler(
  channel: string,
  handler: RuntimeDataHandler,
): () => void {
  if (!validChannel(channel))
    throw new Error(`Invalid HyperFrames runtime-data channel: ${channel}`);
  handlers.set(channel, handler);
  const retainedData = retained.get(channel);
  if (retainedData) deliver(channel, retainedData);
  return () => {
    if (handlers.get(channel) === handler) handlers.delete(channel);
  };
}

export function resetRuntimeDataForTests(): void {
  retained.clear();
  handlers.clear();
  generations.clear();
  localRequestId = 0;
  reportError = () => undefined;
  reportApplied = () => undefined;
}
