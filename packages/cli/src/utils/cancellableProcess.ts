import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import { terminateProcessTree } from "./processTree.js";

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
  onSpawn?: (pid: number) => void;
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

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      const spawnOptions: SpawnOptions = {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      };
      child = spawn(command, [...args], spawnOptions);
    } catch (error) {
      reject(error);
      return;
    }

    if (child.pid) options.onSpawn?.(child.pid);
    let stdout = "";
    let stderr = "";
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
      if (terminationTask) {
        try {
          terminationSignal = await terminationTask;
        } catch (terminationError) {
          error = terminationError;
        }
      }
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
        terminationTask = terminateProcessTree(processTreePid, { child, processGroup: true });
        void terminationTask.catch(() => undefined);
      }
    };
    const onAbort = (): void => terminate(signal?.reason ?? new Error("Operation aborted"));

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBufferBytes) {
        terminate(new Error(`Process output exceeded ${maxBufferBytes} bytes`), "ENOBUFS");
      }
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBufferBytes) {
        terminate(new Error(`Process output exceeded ${maxBufferBytes} bytes`), "ENOBUFS");
      }
    });
    child.once("error", (error) => void finishReject(error));
    // fallow-ignore-next-line complexity
    child.once("close", async (status, closeSignal) => {
      if (settled) return;
      if (terminationTask) {
        try {
          terminationSignal = await terminationTask;
        } catch (error) {
          await finishReject(error);
          return;
        }
      }
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

const SETUP_RESULT_PREFIX = "HYPERFRAMES_RENDER_SETUP_RESULT:";

export async function runRenderSetupWorker<T>(
  mode: "browser" | "lint" | "orphan-cleanup",
  input: unknown,
  options: CancellableProcessOptions,
): Promise<T> {
  const sourceMode = import.meta.url.endsWith(".ts");
  const workerUrl = new URL(
    sourceMode ? "../renderSetupWorker.ts" : "./renderSetupWorker.js",
    import.meta.url,
  );
  const execArgv = sourceMode ? ["--import", "tsx"] : [];
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
    if (error instanceof CancellableProcessError && error.stderr.trim()) {
      throw new Error(error.stderr.trim(), { cause: error });
    }
    throw error;
  }
  if (result.stderr) process.stderr.write(result.stderr);
  const encoded = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith(SETUP_RESULT_PREFIX))
    ?.slice(SETUP_RESULT_PREFIX.length);
  if (!encoded) throw new Error(`${mode} setup process exited without a result`);
  return JSON.parse(encoded) as T;
}
