import { execFile, type ChildProcess } from "node:child_process";
import { promises as dns } from "node:dns";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const DNS_TIMEOUT_MS = 10_000;
const CARES_TIMEOUT_MS = 5_000;

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

// Conservatively exclude special-use networks, including all of 192.0/16.
const NON_PUBLIC_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 16],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
];
const NON_PUBLIC_RANGES = NON_PUBLIC_IPV4.map(([network, prefix]) => ({
  start: ipv4Number(network),
  end: ipv4Number(network) + 2 ** (32 - prefix),
}));

/** Conservative IPv4-only policy: special-use addresses fail closed. */
export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const value = ipv4Number(address);
  return !NON_PUBLIC_RANGES.some(({ start, end }) => value >= start && value < end);
}

/** Validate every A answer, then return a numeric peer that callers must dial directly. */
export async function resolvePublicAddress(hostname: string): Promise<string> {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host) === 4) {
    if (!isPublicIPv4(host)) throw new Error("Capture requires a public IPv4 address");
    return host;
  }
  if (
    !host.includes(".") ||
    !/^[a-z0-9.-]+$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example)$/.test(host) ||
    host.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"))
  ) {
    throw new Error("Capture requires a public hostname");
  }
  const answers = await resolveIPv4(host);
  const first = answers[0];
  if (!first || !answers.every(isPublicIPv4)) {
    throw new Error("Capture DNS returned a non-public address");
  }
  return first;
}

async function resolveIPv4(host: string): Promise<string[]> {
  const fromHostsFile = (await hostsFileAnswers()).get(host);
  if (fromHostsFile) return fromHostsFile;
  const deadline = Date.now() + DNS_TIMEOUT_MS;
  const fromSystem = systemAnswers.get(host);
  if (fromSystem) return beforeDeadline(fromSystem, deadline);
  return resolveWithCares(host).catch(() =>
    beforeDeadline(systemLookupInKillableChild(host, deadline - Date.now()), deadline),
  );
}

let hostsFile: Promise<Map<string, string[]>> | undefined;

function hostsFileAnswers(): Promise<Map<string, string[]>> {
  const path =
    process.platform === "win32"
      ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\drivers\\etc\\hosts`
      : "/etc/hosts";
  hostsFile ??= readFile(path, "utf8").then(parseHostsFile, () => new Map());
  return hostsFile;
}

function parseHostsFile(text: string): Map<string, string[]> {
  const answers = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const [address, ...names] = line.replace(/#.*/, "").trim().split(/\s+/);
    if (!address || isIP(address) !== 4) continue;
    for (const name of names) {
      const key = name.toLowerCase().replace(/\.$/, "");
      answers.set(key, [...(answers.get(key) ?? []), address]);
    }
  }
  return answers;
}

function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Capture DNS timed out")),
      Math.max(0, deadline - Date.now()),
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function resolveWithCares(host: string): Promise<string[]> {
  const cancellableResolver = new dns.Resolver();
  const timer = setTimeout(() => cancellableResolver.cancel(), CARES_TIMEOUT_MS);
  try {
    return await cancellableResolver.resolve4(host);
  } finally {
    clearTimeout(timer);
  }
}

const systemAnswers = new Map<string, Promise<string[]>>();
const SYSTEM_LOOKUP = `require("node:dns").lookup(process.argv[1], { all: true, family: 4 }, (error, answers) =>
  error ? process.stderr.write(String(error.code)) : process.stdout.write(JSON.stringify(answers.map((a) => a.address))))`;

const liveLookups = new Set<ChildProcess>();

export function systemLookupInKillableChild(host: string, timeoutMs: number): Promise<string[]> {
  if (!process.listeners("exit").includes(killLiveLookups)) process.on("exit", killLiveLookups);
  const answers = new Promise<string[]>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ["-e", SYSTEM_LOOKUP, host],
      {
        timeout: Math.max(1, timeoutMs),
        killSignal: "SIGKILL",
        windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: "" },
      },
      (error, stdout, stderr) => {
        if (error?.killed) reject(new Error("Capture DNS timed out"));
        else if (!stdout) reject(new Error(`Capture DNS failed: ${stderr || error?.message}`));
        else {
          try {
            resolve(JSON.parse(stdout) as string[]);
          } catch (parseError) {
            reject(parseError);
          }
        }
      },
    );
    liveLookups.add(child);
    child.once("exit", () => liveLookups.delete(child));
  });
  systemAnswers.set(host, answers);
  answers.catch(() => systemAnswers.delete(host));
  return answers;
}

function killLiveLookups(): void {
  for (const child of liveLookups) child.kill("SIGKILL");
}

/** Pinned asset transport; redirects are returned for caller validation. */
export async function publicRequest(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw new Error("Capture requires an HTTP(S) URL without credentials");
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method) || init.body != null) {
    throw new Error("Capture asset requests support only GET and HEAD without a body");
  }
  // Video callers budget the entire body transfer; a default must not shorten it.
  const signal = init.signal ?? AbortSignal.timeout(30_000);
  signal.throwIfAborted();
  const address = await new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    resolvePublicAddress(target.hostname)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
  signal.throwIfAborted();
  const headers = new Headers(init.headers);
  for (const name of [
    "connection",
    "proxy-authorization",
    "proxy-connection",
    "transfer-encoding",
    "upgrade",
    "content-length",
  ])
    headers.delete(name);
  headers.set("host", target.host);
  headers.set("accept-encoding", "identity");
  return new Promise<Response>((resolve, reject) => {
    const request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      {
        protocol: target.protocol,
        hostname: address,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method,
        headers: Object.fromEntries(headers),
        agent: false,
        servername: target.hostname,
        rejectUnauthorized: true,
        signal,
      },
      (incoming) => {
        try {
          resolve(assetResponse(incoming, req, method));
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      },
    );
    req.once("error", reject);
    req.end();
  });
}

function responseHeaders(incoming: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

function assetResponse(incoming: IncomingMessage, req: ClientRequest, method: string): Response {
  // Even discarded/null bodies can emit errors during socket teardown.
  incoming.on("error", () => {});
  const headers = responseHeaders(incoming);
  const encoding = headers.get("content-encoding")?.toLowerCase();
  if (encoding && encoding !== "identity") {
    throw new Error("Capture server ignored identity content encoding");
  }
  const status = incoming.statusCode ?? 502;
  if (method === "HEAD" || [204, 205, 304].includes(status)) {
    incoming.resume();
    return new Response(null, { status, headers });
  }
  return new Response(responseBody(incoming, req), { status, headers });
}

function responseBody(incoming: IncomingMessage, req: ClientRequest): ReadableStream<Uint8Array> {
  let finished = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.on("data", (chunk: Buffer) => {
        if (finished) return;
        controller.enqueue(chunk);
        incoming.pause();
      });
      incoming.once("end", () => {
        if (finished) return;
        finished = true;
        controller.close();
      });
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        controller.error(error);
      };
      incoming.once("error", fail);
      incoming.once("aborted", () => fail(new Error("Capture response aborted")));
      incoming.pause();
    },
    pull() {
      incoming.resume();
    },
    cancel() {
      finished = true;
      incoming.destroy();
      req.destroy();
    },
  });
}
