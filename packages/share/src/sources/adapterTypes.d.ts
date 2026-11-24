import type { Binding, BindingKey, Manifest } from "./types.js";
import type { SnapshotRef } from "../types/reviewWire.js";
import type { SignedInAccess } from "../signedInRequest.mjs";
import type { SourceApi } from "./api.mjs";

export interface SourceStore {
  read(key: BindingKey): Promise<Binding | null>;
  write(binding: Binding): Promise<void>;
}
export type SourceResult =
  | { at: "ready"; snapshot: SnapshotRef }
  | { at: "unavailable"; reason: string };
export interface SourceOptions {
  access: SignedInAccess;
  spaceId: string;
  store?: SourceStore;
  enabled?: () => boolean;
  fingerprint?: (path: string) => Promise<string | null>;
  /** Host-owned Desktop bindings may be read for exact reuse, never overwritten. */
  existingBinding?: (key: BindingKey) => Promise<Binding | null>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  verificationTimeoutMs?: number;
  onProgress?: (bytes: number) => void;
  /** Test/host seams; the default is the authenticated v3 client. */
  api?: SourceApi;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export interface SourceRun {
  binding: Binding;
  manifest: Manifest;
  api: SourceApi;
  store: SourceStore;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  timeoutMs: number;
  onProgress: (bytes: number) => void;
}
