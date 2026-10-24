import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { terminateProcessTree } from "./processTree.js";
import { renderSetupFailureFrom, renderSetupResultFrom } from "../renderSetupWorkerLifecycle.js";

export interface CancellableProcessResult {
  stdout: string;
  stderr: string;
}

export interface CancellableProcessOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBufferBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  detached?: boolean;
  onSpawn?: (pid: number) => void;
  onStdout?: (chunk: string) => void;
}

class CancellableProcessError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly signal?: NodeJS.Signals;
  readonly stdout: string;
  readonly stderr: string;
  readonly killed: boolean;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      signal?: NodeJS.Signals;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CancellableProcessError";
    this.code = options.code;
    this.status = options.status;
    this.signal = options.signal;
    this.stdout = options.stdout ?? "";
    this.stderr = options.stderr ?? "";
    this.killed = options.killed ?? false;
  }
}

export function runCancellableProcess(
  command: string,
  args: readonly string[],
  options: CancellableProcessOptions = {},
): Promise<CancellableProcessResult> {
  const signal = options.signal;
  signal?.throwIfAborted();

  const detached = options.detached ?? process.platform !== "win32";
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      const spawnOptions: SpawnOptions = {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached,
      };
      child = spawn(command, [...args], spawnOptions);
    } catch (error) {
      reject(error);
      return;
    }

    if (child.pid) options.onSpawn?.(child.pid);
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let outputBytes = 0;
    let settled = false;
    let terminationReason: unknown;
    let terminationSignal: NodeJS.Signals | undefined;
    let terminationCode: string | undefined;
    const maxBufferBytes = options.maxBufferBytes ?? 1024 * 1024;

    const processTreePid = child.pid;
    let operationTimeout: ReturnType<typeof setTimeout> | undefined;
    let terminationTask: Promise<NodeJS.Signals> | undefined;
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
      if (operationTimeout) clearTimeout(operationTimeout);
    };
    const finishReject = async (error: unknown): Promise<void> => {
      if (settled) return;
      if (terminationTask) terminationSignal = await terminationTask.catch(() => terminationSignal);
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const terminate = (reason: unknown, code?: string): void => {
      if (terminationReason !== undefined) return;
      terminationReason = reason;
      terminationCode = code;
      terminationSignal = "SIGTERM";
      if (processTreePid) {
        terminationTask = terminateProcessTree(processTreePid, { child, processGroup: detached });
        void terminationTask.catch(() => undefined);
      }
    };
    const onAbort = (): void => terminate(signal?.reason ?? new Error("Operation aborted"));

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const decoded = typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
      stdout += decoded;
      options.onStdout?.(decoded);
      outputBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (outputBytes > maxBufferBytes) {
        terminate(new Error(`Process output exceeded ${maxBufferBytes} bytes`), "ENOBUFS");
      }
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
      outputBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (outputBytes > maxBufferBytes) {
        terminate(new Error(`Process output exceeded ${maxBufferBytes} bytes`), "ENOBUFS");
      }
    });
    child.once("error", (error) => void finishReject(error));
    // fallow-ignore-next-line complexity
    child.once("close", async (status, closeSignal) => {
      if (settled) return;
      const trailingStdout = stdoutDecoder.end();
      stdout += trailingStdout;
      if (trailingStdout) options.onStdout?.(trailingStdout);
      stderr += stderrDecoder.end();
      if (terminationTask) terminationSignal = await terminationTask.catch(() => terminationSignal);
      if (settled) return;
      settled = true;
      cleanup();
      if (terminationReason !== undefined) {
        if (signal?.aborted && terminationReason === signal.reason) {
          reject(terminationReason);
          return;
        }
        reject(
          new CancellableProcessError(
            terminationReason instanceof Error
              ? terminationReason.message
              : String(terminationReason),
            {
              code: terminationCode,
              signal: closeSignal ?? terminationSignal,
              stdout,
              stderr,
              killed: true,
              cause: terminationReason,
            },
          ),
        );
        return;
      }
      if (status === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new CancellableProcessError(`Command failed: ${command} ${args.join(" ")}`, {
          status: status ?? undefined,
          signal: closeSignal ?? undefined,
          stdout,
          stderr,
        }),
      );
    });

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (options.timeoutMs !== undefined) {
      operationTimeout = setTimeout(() => {
        terminate(new Error(`Process timed out after ${options.timeoutMs} ms`), "ETIMEDOUT");
      }, options.timeoutMs);
      operationTimeout.unref();
    }
  });
}

function renderSetupError(error: unknown): unknown {
  if (!(error instanceof CancellableProcessError)) return error;
  const failure = renderSetupFailureFrom(error.stderr);
  if (failure?.earlierOutput.trim()) process.stderr.write(`${failure.earlierOutput.trimEnd()}\n`);
  const reason = failure?.reason ?? error.stderr.trim();
  return reason ? new Error(reason, { cause: error }) : error;
}

function tsxLoaderFromCliInstall(): string {
  try {
    return import.meta.resolve("tsx");
  } catch {
    return "tsx";
  }
}

export async function runRenderSetupWorker<T>(
  mode: "browser" | "browser-install" | "lint" | "orphan-cleanup",
  input: unknown,
  options: CancellableProcessOptions,
): Promise<T> {
  const sourceMode = import.meta.url.endsWith(".ts");
  const workerUrl = new URL(
    sourceMode ? "../renderSetupWorker.ts" : "./renderSetupWorker.js",
    import.meta.url,
  );
  const execArgv =
    sourceMode && !process.versions.bun ? ["--import", tsxLoaderFromCliInstall()] : [];
  let result: CancellableProcessResult;
  try {
    result = await runCancellableProcess(
      process.execPath,
      [...execArgv, fileURLToPath(workerUrl), mode],
      {
        ...options,
        env: {
          ...process.env,
          ...options.env,
          HYPERFRAMES_RENDER_SETUP_INPUT: JSON.stringify(input),
        },
      },
    );
  } catch (error) {
    if (options.signal?.aborted) options.signal.throwIfAborted();
    throw renderSetupError(error);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  const value = renderSetupResultFrom(result.stdout);
  if (value === undefined) throw new Error(`${mode} setup process exited without a result`);
  return value as T;
}
