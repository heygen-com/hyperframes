import type { ServerResponse } from "node:http";
import { isIP } from "node:net";
import type { Connect } from "vite";
import type { PersistAdapter } from "@hyperframes/sdk";

const COMP_PATH = "composition.html";
const MAX_BODY_BYTES = 32 * 1024 * 1024;

type Handler = (req: Connect.IncomingMessage, res: ServerResponse) => Promise<void>;

// The parts of Vite's resolved server options that decide which Hosts it serves the page on.
interface ServerHostOptions {
  allowedHosts?: readonly string[] | true;
  https?: unknown;
  host?: string | boolean;
  origin?: string;
  hmr?: boolean | { host?: string };
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

function configuredHosts(server: ServerHostOptions): string[] {
  const names = [...(server.allowedHosts === true ? [] : (server.allowedHosts ?? []))];
  if (typeof server.host === "string") names.push(server.host);
  if (typeof server.hmr === "object" && server.hmr.host) names.push(server.hmr.host);
  if (server.origin) names.push(hostnameOf(server.origin));
  return names.filter((name) => name !== "").map((name) => name.toLowerCase());
}

function matchesConfiguredHost(name: string, server: ServerHostOptions): boolean {
  return configuredHosts(server).some(
    (allowed) =>
      allowed === name ||
      (allowed.startsWith(".") && (name === allowed.slice(1) || name.endsWith(allowed))),
  );
}

function nameAllowed(host: string, server: ServerHostOptions): boolean {
  const bracketed = /^\[([^\]]+)\]/.exec(host);
  if (bracketed) return isIP(bracketed[1] ?? "") === 6;
  const name = (host.split(":")[0] ?? "").toLowerCase();
  if (isIP(name) === 4 || name === "localhost" || name.endsWith(".localhost")) return true;
  return matchesConfiguredHost(name, server);
}

// Vite checks Host only after plugin middlewares, so these routes apply its rule themselves.
function hostAllowed(host: string | undefined, server: ServerHostOptions): boolean {
  if (server.allowedHosts === true || server.https) return true;
  return host !== undefined && host !== "" && nameAllowed(host, server);
}

function writeFromAnotherSite(req: Connect.IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin") return true;
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host.toLowerCase() !== (req.headers.host ?? "").toLowerCase();
  } catch {
    return true;
  }
}

function refuse(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

// The composition is data for the playground's fetch, never a page a browser should render or frame.
function sendComposition(res: ServerResponse, html: string | undefined) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  if (html === undefined) {
    res.statusCode = 404;
    res.end("");
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(html);
}

function readBodyWithinLimit(req: Connect.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let ended = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY_BYTES) return void chunks.push(c);
      chunks.length = 0;
      resolve(null);
    });
    req.on("end", () => {
      ended = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
    req.on("close", () => {
      if (!ended) reject(new Error("request closed before its body ended"));
    });
  });
}

function versionKeyOf(req: Connect.IncomingMessage): string | null {
  return new URL(req.url ?? "/", "http://localhost").searchParams.get("version");
}

function methodNotAllowed(res: ServerResponse) {
  res.statusCode = 405;
  res.end();
}

async function handleCompositionGet(
  adapter: PersistAdapter,
  req: Connect.IncomingMessage,
  res: ServerResponse,
) {
  const versionKey = versionKeyOf(req);
  const html = versionKey
    ? await adapter.loadFrom(COMP_PATH, versionKey)
    : await adapter.read(COMP_PATH);
  sendComposition(res, html);
}

async function handleCompositionPut(
  adapter: PersistAdapter,
  req: Connect.IncomingMessage,
  res: ServerResponse,
) {
  if (writeFromAnotherSite(req)) return refuse(res, 403, "forbidden: cross-site write");
  const body = await readBodyWithinLimit(req).catch(() => undefined);
  if (body === undefined) return refuse(res, 400, "incomplete request body");
  if (body === null) {
    res.setHeader("Connection", "close");
    return refuse(res, 413, "composition too large");
  }
  await adapter.write(COMP_PATH, body);
  res.statusCode = 204;
  res.end();
}

async function handleVersions(
  adapter: PersistAdapter,
  req: Connect.IncomingMessage,
  res: ServerResponse,
) {
  if (req.method !== "GET") return methodNotAllowed(res);
  const versions = await adapter.listVersions(COMP_PATH);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(versions.map((v) => ({ key: v.key, timestamp: v.timestamp }))));
}

async function handleComposition(
  adapter: PersistAdapter,
  req: Connect.IncomingMessage,
  res: ServerResponse,
) {
  if (req.method === "GET") return handleCompositionGet(adapter, req, res);
  if (req.method === "PUT") return handleCompositionPut(adapter, req, res);
  methodNotAllowed(res);
}

export function createCompositionApi(
  adapter: PersistAdapter,
  server: ServerHostOptions = {},
): { versions: Handler; composition: Handler } {
  const guarded =
    (handle: typeof handleComposition): Handler =>
    async (req, res) => {
      if (!hostAllowed(req.headers.host, server)) {
        return refuse(res, 403, `forbidden: host "${req.headers.host ?? ""}" is not allowed`);
      }
      await handle(adapter, req, res);
    };
  return { versions: guarded(handleVersions), composition: guarded(handleComposition) };
}
