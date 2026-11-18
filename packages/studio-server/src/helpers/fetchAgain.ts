import type { Hono } from "hono";

const sentAgain = new WeakSet<Request>();

export function fetchAgain(api: Hono, request: Request): Response | Promise<Response> {
  sentAgain.add(request);
  return api.fetch(request);
}

export const isFetchedAgain = (request: Request) => sentAgain.has(request);
