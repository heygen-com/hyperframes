import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { connect, type Socket } from "node:net";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";
import {
  Frame,
  HANDSHAKE_TIMEOUT_MS,
  WARM_IDLE_MS,
  encodeFrame,
  envDigest,
  frameReader,
  keyed,
  sameProof,
  warmCheckEndpoint,
  type WarmRequest,
} from "./warmCheckProtocol.js";

const distDir = dirname(fileURLToPath(import.meta.url));
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const launchEnv = { ...process.env };

export function warmCheckEligible(
  argv = process.argv,
  env = process.env,
  stdoutTTY = process.stdout.isTTY,
  stderrTTY = process.stderr.isTTY,
): boolean {
  return argv[2] === "check" && !stdoutTTY && !stderrTTY && !env.CI && !argv.includes("--help");
}

export function warmCheckOutcome(
  exitCode: number | undefined,
  wrote: boolean,
  signalled: NodeJS.Signals | undefined,
): { served: boolean; exitCode?: number; message?: string } {
  if (exitCode !== undefined) return { served: true, exitCode };
  if (signalled) return { served: true, exitCode: 128 + (constants.signals[signalled] ?? 0) };
  if (!wrote) return { served: false };
  return {
    served: true,
    exitCode: 1,
    message: "The warm check process stopped before finishing.\n",
  };
}

function connected(address: string): Promise<Socket | undefined> {
  return new Promise((resolveSocket) => {
    const socket = connect(address);
    socket.once("connect", () => resolveSocket(socket));
    socket.once("error", () => resolveSocket(undefined));
  });
}

interface ServerProof {
  proof?: unknown;
  nonce?: unknown;
}

function parsedProof(type: Frame, body: Buffer): ServerProof | undefined {
  if (type !== Frame.Proof) return undefined;
  try {
    return JSON.parse(body.toString()) as ServerProof;
  } catch {
    return undefined;
  }
}

export async function runWarmCheck(endpoint = warmCheckEndpoint(launchEnv)): Promise<boolean> {
  if (!endpoint) return false;
  const socket = await connected(endpoint.address);
  if (!socket) return false;
  const nonce = randomBytes(16).toString("hex");
  let trusted = false;
  let wrote = false;
  let signalled: (typeof FORWARDED_SIGNALS)[number] | undefined;
  const relay = (signal: (typeof FORWARDED_SIGNALS)[number]) => {
    signalled = signal;
    if (trusted) socket.write(encodeFrame(Frame.Signal, signal));
    else socket.destroy();
  };
  for (const signal of FORWARDED_SIGNALS) process.on(signal, relay);
  try {
    return await new Promise<boolean>((resolveRun) => {
      let exitCode: number | undefined;
      const sinks = new Map<Frame, NodeJS.WritableStream>([
        [Frame.Stdout, process.stdout],
        [Frame.Stderr, process.stderr],
      ]);
      const handshake = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
      const trust = (type: Frame, body: Buffer) => {
        const server = parsedProof(type, body);
        if (!server || !sameProof(keyed(endpoint.token, "server", nonce), server.proof)) {
          socket.destroy();
          return;
        }
        trusted = true;
        clearTimeout(handshake);
        const request: WarmRequest = {
          argv: process.argv.slice(2),
          script: process.argv[1] ?? "",
          cwd: process.cwd(),
          envDigest: envDigest(endpoint.token, launchEnv),
          proof: keyed(endpoint.token, "client", String(server.nonce)),
        };
        socket.write(encodeFrame(Frame.Request, JSON.stringify(request)));
      };
      const read = frameReader((type, body) => {
        if (!trusted) return trust(type, body);
        if (type === Frame.Exit) exitCode = Number(body.toString());
        const sink = sinks.get(type);
        if (!sink) return;
        sink.write(body);
        wrote = true;
      });
      socket.on("data", (chunk: Buffer) => {
        if (!read(chunk)) socket.destroy();
      });
      socket.on("error", () => {});
      socket.on("close", () => {
        clearTimeout(handshake);
        const outcome = warmCheckOutcome(exitCode, wrote, signalled);
        if (outcome.message) process.stderr.write(outcome.message);
        if (outcome.served) process.exitCode = outcome.exitCode;
        resolveRun(outcome.served);
      });
      socket.write(encodeFrame(Frame.Hello, nonce));
    });
  } finally {
    for (const signal of FORWARDED_SIGNALS) process.off(signal, relay);
  }
}

export function startNextWarmCheck(endpoint = warmCheckEndpoint(launchEnv)): void {
  if (!endpoint) return;
  const args = [String(WARM_IDLE_MS), ...process.argv.slice(3)];
  spawn(process.execPath, [join(distDir, "warmCheck.js"), ...args], {
    cwd: process.cwd(),
    env: launchEnv,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}
