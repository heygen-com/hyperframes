// fallow-ignore-file unused-class-member
// `FakeSocket`'s members are the `VstSocketLike` interface surface, called on
// instances from the consuming test files (useVstHost.test.tsx /
// useVstPreview.test.tsx) — genuinely used, but invisible to a same-file
// dead-code scan now that the class lives in its own shared module.
/**
 * Shared WebSocket test double for `useVstHost` — used by both
 * `useVstHost.test.tsx` (the hook's own unit tests) and
 * `useVstPreview.test.tsx` (which drives the REAL `useVstHost` through this
 * same seam per its integration-test doc-comment) so the two suites' fake
 * socket behavior can't drift apart.
 *
 * Injected via `useVstHost`'s `__setSocketFactoryForTests` module-level
 * override rather than a real `WebSocket` — production code just calls
 * `new WebSocket(url)`.
 */

import type { VstSocketLike } from "./useVstHost";

export class FakeSocket implements VstSocketLike {
  static instances: FakeSocket[] = [];
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.(new CloseEvent("close"));
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  emitJson(payload: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  emitBinary(buf: ArrayBuffer): void {
    this.onmessage?.(new MessageEvent("message", { data: buf }));
  }
}

/** Narrows away `null`/`undefined` without a `!` assertion (repo convention). */
export function required<T>(value: T | null | undefined, label = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`${label} was unexpectedly missing`);
  }
  return value;
}
