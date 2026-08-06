import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { client, ndJsonStream, type ClientContext, type Stream } from "@agentclientprotocol/sdk";

/**
 * Talking to an agent over the Agent Client Protocol.
 *
 * Studio's other transport spawns a CLI and reads whatever it prints, which
 * means a parser per harness and no way to answer a question the agent asks.
 * ACP is the published standard for this boundary: JSON-RPC over stdio, with
 * capabilities negotiated up front and permission requests carried by the
 * protocol rather than settled behind our back.
 *
 * This module owns one thing: getting a connection open, the handshake done,
 * and the process cleaned up afterwards. What to do with the connection is the
 * session runner's business.
 */

/** How to start an ACP agent. */
export interface AcpAgentSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Overridable so a test does not have to wait out the real deadline. */
  handshakeTimeoutMs?: number;
  /**
   * The process, once it exists. Studio stops a run by killing its child, and
   * that has to keep working for an agent it reaches over a protocol.
   */
  onSpawn?: (child: ChildProcess) => void;
}

/** What the agent said it can do, from its `initialize` response. */
export interface AcpHandshake {
  protocolVersion: number;
  agentCapabilities: Record<string, unknown>;
  authMethods: Array<{ id: string; name?: string }>;
}

/** An open, initialized connection, for the lifetime of the caller's work. */
export interface AcpConnection {
  handshake: AcpHandshake;
  context: ClientContext;
}

/** What the client half answers while a run is in flight. */
export interface AcpClientHandlers {
  /** A `session/update` notification: tool calls, message chunks, plans. */
  onUpdate?: (params: Record<string, unknown>) => void;
  /**
   * The agent asking before it acts. Resolve with the id of the option the
   * user chose. Absent means Studio answers nothing and the agent's own
   * default applies, which is the pre-ACP behaviour.
   */
  onPermission?: (params: Record<string, unknown>) => Promise<{ optionId: string }>;
}

/** The protocol version this client speaks. v2 exists but only in draft. */
const PROTOCOL_VERSION = 1;
/** How long the handshake may take before the agent is declared unreachable. */
const HANDSHAKE_TIMEOUT_MS = 15_000;
/**
 * How long to wait for a dead child's `exit` event before giving up on it.
 *
 * A process that dies mid-handshake closes stdout, which the protocol layer
 * reports as a bare "connection closed" — true, and useless. The exit code is
 * the part worth telling the user, and it arrives on its own schedule.
 */
const EXIT_REPORT_MS = 200;
/** How much of an agent's stderr to keep for explaining a failure. */
const STDERR_KEPT = 2000;

/**
 * What Studio can do for an agent that asks.
 *
 * Both filesystem and terminal are declared false: the agent runs in the
 * project directory with its own tools, and claiming capabilities we have not
 * implemented would make it wait on calls we cannot answer.
 */
const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
} as const;

/** Rejects when the agent has taken too long to answer `initialize`. */
function handshakeDeadline(
  abort: AbortController,
  label: string,
  timeoutMs: number,
): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => {
      abort.abort();
      reject(new Error(`${label} did not answer the ACP handshake within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    // Node would otherwise hold the process open for the full timeout.
    timer.unref?.();
  });
}

function readHandshake(result: unknown): AcpHandshake {
  const value = (result ?? {}) as Record<string, unknown>;
  const version = value.protocolVersion;
  return {
    protocolVersion: typeof version === "number" ? version : PROTOCOL_VERSION,
    agentCapabilities:
      typeof value.agentCapabilities === "object" && value.agentCapabilities !== null
        ? (value.agentCapabilities as Record<string, unknown>)
        : {},
    authMethods: Array.isArray(value.authMethods)
      ? value.authMethods.flatMap((method) =>
          typeof method === "object" &&
          method !== null &&
          typeof (method as { id?: unknown }).id === "string"
            ? [method as { id: string; name?: string }]
            : [],
        )
      : [],
  };
}

/**
 * Run `op` against an already-open stream.
 *
 * Split out from the spawning below so the protocol half can be exercised
 * against an in-process agent: the SDK can connect a client app straight to an
 * agent app, which means the handshake, the update handler and the permission
 * handler are all testable without a subprocess.
 */
export async function withAcpStream<T>(
  stream: Stream,
  handlers: AcpClientHandlers,
  op: (connection: AcpConnection) => Promise<T>,
  options: {
    /** Named in the timeout message, so a stuck agent is identifiable. */
    label?: string;
    handshakeTimeoutMs?: number;
  } = {},
): Promise<T> {
  const label = options.label ?? "The ACP agent";
  const timeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const app = client();
  if (handlers.onUpdate) {
    app.onNotification("session/update", (event) => {
      handlers.onUpdate?.(event.params as Record<string, unknown>);
    });
  }
  if (handlers.onPermission) {
    app.onRequest("session/request_permission", async (event) => {
      const chosen = await handlers.onPermission!(event.params as Record<string, unknown>);
      return { outcome: { outcome: "selected", optionId: chosen.optionId } };
    });
  }

  return app.connectWith(stream, async (context) => {
    const abort = new AbortController();
    // The signal alone is not a deadline: the SDK documents cancellation as
    // cooperative, so the request settles only when the peer answers. An agent
    // that never answers needs a race to become an error rather than a hang.
    const result = await Promise.race([
      context.request(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: CLIENT_CAPABILITIES,
          clientInfo: { name: "hyperframes-studio", title: "HyperFrames Studio", version: "1" },
        },
        { cancellationSignal: abort.signal },
      ),
      handshakeDeadline(abort, label, timeoutMs),
    ]);
    return op({ handshake: readHandshake(result), context });
  });
}

/**
 * Start an agent, complete the handshake, run `op`, and always clean up.
 *
 * The process is killed on the way out whatever happened, so a run that throws
 * mid-turn cannot leave an agent holding the project directory.
 */
export async function withAcpAgent<T>(
  spec: AcpAgentSpec,
  handlers: AcpClientHandlers,
  op: (connection: AcpConnection) => Promise<T>,
): Promise<T> {
  let child: ChildProcess;
  try {
    child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`${spec.command} could not be started: ${describe(error)}`);
  }
  spec.onSpawn?.(child);

  // An agent that dies takes its stdout with it, and the protocol layer only
  // knows the connection closed. Watching the process is how the reason
  // survives to the error the user reads.
  let ended: string | null = null;
  const endedSoon = new Promise<string | null>((resolve) => {
    const settle = (reason: string) => {
      ended = reason;
      resolve(reason);
    };
    child.once("error", (error) => settle(describe(error)));
    child.once("exit", (code, signal) =>
      settle(signal ? `was killed by ${signal}` : `exited with code ${code}`),
    );
  });

  // The protocol carries no diagnostics: an agent that fails answers with a
  // JSON-RPC error as terse as "Internal error" and explains itself on stderr.
  // Thrown away, that leaves the user with a failure and no reason for it.
  let complaints = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    complaints = (complaints + chunk.toString()).slice(-STDERR_KEPT);
  });

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  );

  try {
    return await withAcpStream(stream, handlers, op, {
      label: spec.command,
      handshakeTimeoutMs: spec.handshakeTimeoutMs,
    });
  } catch (error) {
    // The exit event races the stream closing, so a short wait is what decides
    // whether this failure has a process death behind it.
    const reason =
      ended ??
      (await Promise.race([
        endedSoon,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), EXIT_REPORT_MS)),
      ]));
    if (reason) throw new Error(`${spec.command} ${reason} before the ACP run finished`);
    throw explain(error, complaints);
  } finally {
    child.kill();
  }
}

/** The agent's own error, with whatever it said on stderr about why. */
function explain(error: unknown, complaints: string): Error {
  const said = lastComplaint(complaints);
  const message = describe(error);
  return said && !message.includes(said) ? new Error(`${message}: ${said}`) : new Error(message);
}

/**
 * Terminal colour codes. Built at runtime: the escape byte cannot be written
 * into a regex literal without putting a control character in the source.
 */
const COLOUR_CODES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * The last thing of substance on stderr; startup banners are not the reason.
 *
 * Agents log to a terminal, so their diagnostics arrive dressed in colour
 * codes. Those are noise in a run's message, where nothing renders them.
 */
function lastComplaint(complaints: string): string {
  const lines = complaints
    .replace(COLOUR_CODES, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1)?.slice(0, 300) ?? "";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
