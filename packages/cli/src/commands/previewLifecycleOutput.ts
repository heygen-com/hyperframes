export type PreviewLifecycleOperation = "start" | "status" | "stop" | "list" | "kill-all";

export type PreviewLifecycleState = "started" | "reused" | "running";

export interface PreviewLifecycleSession {
  state: PreviewLifecycleState;
  mode: "background" | "foreground" | "unknown";
  projectName: string;
  projectDir: string;
  host: string;
  port: number;
  pid: number | null;
  serverUrl: string;
  studioUrl: string;
  ready: boolean;
  logPath?: string;
}

export type PreviewLifecycleResult =
  | PreviewLifecycleSession
  | { state: "not-running"; projectDir?: string }
  | { state: "stopped"; projectDir: string }
  | { state: "listed"; sessions: readonly PreviewLifecycleSession[] }
  /**
   * `failed` carries the records a stop pass could not prove ownership of;
   * `unverifiedPorts` the ones skipped because the OS would not confirm which
   * process owns the socket. Both are omissions from `stopped`, so an agent
   * that only reads the count would otherwise see a silent shortfall.
   */
  | {
      state: "killed-all";
      stopped: number;
      failed?: readonly string[];
      unverifiedPorts?: readonly number[];
    };

export interface PreviewLifecyclePayload {
  schemaVersion: 1;
  operation: PreviewLifecycleOperation;
  ok: true;
  result: PreviewLifecycleResult;
}

export interface PreviewLifecycleFailurePayload {
  schemaVersion: 1;
  operation: PreviewLifecycleOperation;
  ok: false;
  error: { code: string; message: string };
}

export function lifecyclePayload(
  operation: PreviewLifecycleOperation,
  result: PreviewLifecycleResult,
): PreviewLifecyclePayload {
  return { schemaVersion: 1, operation, ok: true, result };
}

export function lifecycleFailurePayload(
  operation: PreviewLifecycleOperation,
  code: string,
  message: string,
): PreviewLifecycleFailurePayload {
  return { schemaVersion: 1, operation, ok: false, error: { code, message } };
}

export function writeLifecycleJson(
  payload: PreviewLifecyclePayload | PreviewLifecycleFailurePayload,
): void {
  console.log(JSON.stringify(payload));
}
