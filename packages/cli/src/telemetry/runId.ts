import { randomUUID } from "node:crypto";

let resolved = false;
let runId: string | undefined;

export function getRunId(): string | undefined {
  if (!resolved) {
    const value = process.env["HYPERFRAMES_RUN_ID"]?.trim().slice(0, 128);
    runId = value ? value : undefined;
    resolved = true;
  }

  return runId;
}

// ---------------------------------------------------------------------------
// Invocation id — a random uuid minted once per CLI process, present on every
// event that process emits. Unlike run_id (set only when an orchestrator
// exports HYPERFRAMES_RUN_ID), it needs no environment plumbing: it exists so
// the events of ONE invocation can be grouped even when the install identity
// is untrustworthy (identity_persistence != durable, e.g. an ephemeral HOME
// minting a fresh anonymousId per run).
// ---------------------------------------------------------------------------

let invocationId: string | undefined;

export function getInvocationId(): string {
  invocationId ??= randomUUID();
  return invocationId;
}
