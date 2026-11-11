/** An error and its `cause` chain as one line: undici's reason, such as a self-signed certificate, sits a level or two down. */
export function describeCauseChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = "code" in current ? current.code : undefined;
    const text =
      code && !current.message.includes(String(code))
        ? `${current.message} [${String(code)}]`
        : current.message;
    if (text && !parts.includes(text)) parts.push(text);
    current = current.cause;
  }
  if (parts.length === 0) return String(err);
  const [head, ...rest] = parts;
  return rest.length ? `${head} (${rest.join("; ")})` : head!;
}

const OFFLINE = "this machine looks offline";
const REASONS: [RegExp, string][] = [
  [/certificate|self[- ]signed|unable to verify|altname/i, "the secure connection was refused"],
  [
    /ENOTFOUND|EAI_AGAIN|EAI_NONAME|getaddrinfo/,
    `its address could not be looked up (DNS); ${OFFLINE}`,
  ],
  [/ENETUNREACH|EHOSTUNREACH|ENETDOWN/, `there is no network route to it; ${OFFLINE}`],
  [/ECONNREFUSED/, "it refused the connection"],
  [/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|TimeoutError|timed? ?out/i, "it did not answer in time"],
  [/ECONNRESET|socket hang up|UND_ERR_SOCKET|other side closed/i, "the connection dropped"],
];

const NEXT_STEP =
  "Check the internet connection (behind a proxy, set HTTPS_PROXY) and run the command again.";

/** A request that never got an HTTP answer, worded with the host, the reason and what to do next. */
export class NetworkFailure extends Error {
  readonly hint = NEXT_STEP;
  constructor(host: string, reason: string, options: { cause: unknown }) {
    super(`Could not reach ${host}: ${reason}.`, options);
    this.name = "NetworkFailure";
  }
}

function isTransportFailure(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError") return true;
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

/**
 * Names what went wrong when `fetch(url)` threw before any response, so the person sees the host and a next step
 * instead of undici's bare `fetch failed`. Any other error comes back unchanged.
 */
export function explainNetworkFailure(error: unknown, url: string): unknown {
  if (error instanceof NetworkFailure || !isTransportFailure(error)) return error;
  const chain = describeCauseChain(error);
  const reason =
    REASONS.find(([pattern]) => pattern.test(chain))?.[1] ?? `the request failed (${chain})`;
  return new NetworkFailure(new URL(url).host, reason, { cause: error });
}

/** `fetch`, with a transport failure rethrown as a {@link NetworkFailure}. */
export async function fetchExplained(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw explainNetworkFailure(error, url);
  }
}
