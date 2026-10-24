import { randomBytes } from "node:crypto";
import { unlinkSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { prelaunchBrowserForCheck } from "./commands/check.js";
import "./utils/checkBrowser.js";
import { registerRootExitRequester } from "./utils/commandResult.js";
import {
  Frame,
  encodeFrame,
  envDigest,
  frameForwarder,
  frameReader,
  keyed,
  sameProof,
  warmCheckEndpoint,
  type WarmRequest,
} from "./warmCheckProtocol.js";

const [idleMs = "0", ...checkArgs] = process.argv.slice(2);
const endpoint = warmCheckEndpoint();
if (!endpoint) process.exit(0);
const { address, token } = endpoint;
const startDigest = envDigest(token, process.env);
const exit = process.exit.bind(process);
const idle = setTimeout(() => exit(0), Number(idleMs));
registerRootExitRequester(exit);
let listening = false;
let served: Socket | undefined;

process.on("exit", () => {
  if (listening && process.platform !== "win32") {
    try {
      unlinkSync(address);
    } catch {}
  }
});

const RELAYED_SIGNALS = new Set(["SIGINT", "SIGTERM", "SIGHUP"]);

async function serve(socket: Socket, request: WarmRequest): Promise<void> {
  let finished = false;
  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    server.close();
    listening = false;
    socket.end(encodeFrame(Frame.Exit, String(code)), () => exit(code));
  };
  socket.on("close", () => {
    if (!finished) process.kill(process.pid, "SIGKILL");
  });
  process.stdout.write = frameForwarder(socket, Frame.Stdout);
  process.stderr.write = frameForwarder(socket, Frame.Stderr);
  process.exit = ((code?: number | string | null) =>
    finish(Number(code ?? process.exitCode ?? 0))) as typeof process.exit;
  process.chdir(request.cwd);
  process.argv = [process.execPath, request.script, ...request.argv];
  await import(new URL("./cli.js", import.meta.url).href);
  setImmediate(() => finish(Number(process.exitCode ?? 0)));
}

function decline(socket: Socket, yieldToNewEnvironment: boolean): void {
  socket.end(encodeFrame(Frame.Declined, "declined"), () => {
    if (yieldToNewEnvironment) exit(0);
  });
}

function accept(socket: Socket, request: WarmRequest, nonce: string): void {
  const fresh = !served && sameProof(keyed(token, "client", nonce), request.proof);
  if (!fresh || !sameProof(startDigest, request.envDigest)) return decline(socket, fresh);
  served = socket;
  clearTimeout(idle);
  void serve(socket, request);
}

function parsedRequest(body: Buffer): WarmRequest | undefined {
  try {
    return JSON.parse(body.toString()) as WarmRequest;
  } catch {
    return undefined;
  }
}

function relaySignal(socket: Socket, signal: string): void {
  if (socket === served && RELAYED_SIGNALS.has(signal)) {
    process.kill(process.pid, signal as NodeJS.Signals);
  }
}

function handshake(socket: Socket, nonce: string, type: Frame, body: Buffer): boolean {
  if (type === Frame.Hello) {
    const proof = keyed(token, "server", body.toString());
    socket.write(encodeFrame(Frame.Proof, JSON.stringify({ proof, nonce })));
    return false;
  }
  const request = type === Frame.Request ? parsedRequest(body) : undefined;
  if (request) accept(socket, request, nonce);
  return request !== undefined;
}

const server = createServer((socket) => {
  const nonce = randomBytes(16).toString("hex");
  let accepted = false;
  socket.on("error", () => {});
  const read = frameReader((type, body) => {
    if (type === Frame.Signal) relaySignal(socket, body.toString());
    else if (!accepted) accepted = handshake(socket, nonce, type, body);
  });
  socket.on("data", (chunk: Buffer) => {
    if (!read(chunk)) socket.destroy();
  });
});

function listen(): void {
  server.listen(address, () => {
    listening = true;
  });
}

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE" || process.platform === "win32") exit(0);
  const probe = connect(address, () => {
    probe.destroy();
    exit(0);
  });
  probe.on("error", () => {
    try {
      unlinkSync(address);
    } catch {}
    listen();
  });
});

listen();
void prelaunchBrowserForCheck(checkArgs).catch(() => undefined);
