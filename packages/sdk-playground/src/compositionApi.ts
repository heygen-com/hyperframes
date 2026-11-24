import type { ServerResponse } from "node:http";
import { isIP } from "node:net";
import type { Connect } from "vite";
import type { PersistAdapter } from "@hyperframes/sdk";

const COMP_PATH = "composition.html";
const MAX_BODY_BYTES = 32 * 1024 * 1024;

type Handler = (req: Connect.IncomingMessage, res: ServerResponse) => Promise<void>;

// Vite checks Host only after plugin middlewares, so mirror its default rule here: localhost, *.localhost, IP literals.
function hostAllowed(host: string | undefined, extraHosts: readonly string[]): boolean {
  if (!host) return false;
  const bracketed = /^\[([^\]]+)\]/.exec(host);
  if (bracketed) return isIP(bracketed[1] ?? "") === 6;
  const name = (host.split(":")[0] ?? "").toLowerCase();
  if (isIP(name) === 4 || name === "localhost" || name.endsWith(".localhost")) return true;
  return extraHosts.some((extra) => extra.toLowerCase() === name);
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

function sendHtml(res: ServerResponse, html: string | undefined) {
  if (html === undefined) {
    res.statusCode = 404;
    res.end("");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function readBodyWithinLimit(req: Connect.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY_BYTES) return void chunks.push(c);
      chunks.length = 0;
      resolve(null);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
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
  sendHtml(res, html);
}

async function handleCompositionPut(
  adapter: PersistAdapter,
  req: Connect.IncomingMessage,
  res: ServerResponse,
) {
  if (writeFromAnotherSite(req)) return refuse(res, 403, "forbidden: cross-site write");
  const body = await readBodyWithinLimit(req);
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
  extraHosts: readonly string[] = [],
): { versions: Handler; composition: Handler } {
  const guarded =
    (handle: typeof handleComposition): Handler =>
    async (req, res) => {
      if (!hostAllowed(req.headers.host, extraHosts)) {
        return refuse(res, 403, `forbidden: host "${req.headers.host ?? ""}" is not allowed`);
      }
      await handle(adapter, req, res);
    };
  return { versions: guarded(handleVersions), composition: guarded(handleComposition) };
}
