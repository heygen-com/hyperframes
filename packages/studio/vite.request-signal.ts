import type { ServerResponse } from "node:http";

export function bindNodeRequestSignal(response: ServerResponse): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  response.once("close", abort);
  return { signal: controller.signal, dispose: () => response.off("close", abort) };
}
