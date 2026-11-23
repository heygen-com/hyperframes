// @ts-check

/** The sign-in exists but its renewal could not reach HeyGen: a reader throws it, and a request reads it as offline,
 * never as signed out. */
export class AccountUnreachable extends Error {
  constructor() {
    super("the saved sign-in could not be renewed: HeyGen was unreachable");
    this.name = "AccountUnreachable";
  }
}

/** What a sign-in read yields, through readOrUnreachable, when its renewal could not reach HeyGen. */
export const UNREACHABLE = /** @type {"unreachable"} */ ("unreachable");

/** `access(refused)`, or UNREACHABLE when the saved sign-in's renewal could not reach HeyGen; other errors rethrow.
 * @template T @param {(refused?: string) => Promise<T>} access @param {string} [refused] */
export async function readOrUnreachable(access, refused) {
  try {
    return await access(refused);
  } catch (error) {
    if (error instanceof AccountUnreachable) return UNREACHABLE;
    throw error;
  }
}

/** `run`, answering `value` when the saved sign-in's renewal could not reach HeyGen; other errors rethrow. A probe's
 * `access` is `orIfUnreachable(access, null)`. @template {any[]} A, R @param {(...args: A) => Promise<R>} run
 * @param {R} value */
export const orIfUnreachable =
  (run, value) =>
  async (/** @type {A} */ ...args) => {
    try {
      return await run(...args);
    } catch (error) {
      if (error instanceof AccountUnreachable) return value;
      throw error;
    }
  };

/** The sign-in each send reads again: the bearer, the backend it is for and the account it is; null signed out, and
 * a reader may throw AccountUnreachable. A host's reader may take a bearer a server refused, which these requests
 * never pass.
 * @typedef {(refused?: string) => Promise<{ token: string, heygen: string, heygenApi: string, owner?: string | null }
 *   | null>} SignedInAccess */

/** `host` picks the sign-in host or HeyGen's /v3 API; `trace` marks `answers` as answers, not failures.
 * `headers` go on every send, beneath a call's own.
 * @typedef {{ access: SignedInAccess, fetchImpl?: typeof fetch, timeoutMs: number, tag: string, offline: () => Error,
 *   headers?: Record<string, string>,
 *   signedOut: () => Error, host?: "heygen" | "heygenApi",
 *   trace?: (init: RequestInit, answers: number[]) => RequestInit }} SignedInDeps */

/** Requests to a HeyGen host as the signed-in person. A 401 reads the sign-in again and retries only with a
 * renewed token; a second 401 comes back as the answer. Signed out, or the same token refused, throws `signedOut()`;
 * an unreachable server throws `offline()`. @param {SignedInDeps} deps */
export function signedInRequest({
  access,
  fetchImpl = fetch,
  timeoutMs,
  tag,
  offline,
  signedOut,
  host = "heygen",
  headers: always = {},
  trace = (init) => init,
}) {
  /** @param {{ token: string, heygen: string, heygenApi: string }} signedIn
   * @param {string} method @param {string} route @param {unknown} body @param {Record<string, string>} headers
   * @param {number[] | null} answers @param {string} label */
  const send = (signedIn, method, route, body, headers, answers, label) => {
    /** @type {RequestInit} */
    const init = {
      method,
      headers: {
        // Never a caller's Authorization, in any case: fetch would join it to the bearer.
        ...Object.fromEntries(
          Object.entries({ ...always, ...headers }).filter(
            ([name]) => name.toLowerCase() !== "authorization",
          ),
        ),
        authorization: `Bearer ${signedIn.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      // A redirect would drop the bearer.
      redirect: "error",
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    };
    return fetchImpl(`${signedIn[host]}${route}`, answers ? trace(init, answers) : init).catch(
      (error) => {
        console.error(`[${tag}] ${label} failed:`, /** @type {Error} */ (error).name);
        throw offline();
      },
    );
  };

  /** `answers`: a background check's own "no" (offline is then one too), not reported as an API failure. `label`
   * names the call in the log in place of its route, for a route that carries a secret (a share token).
   * @param {string} method @param {string} route @param {unknown} [body] @param {Record<string, string>} [headers]
   * @param {number[] | null} [answers] @param {string} [label]
   * @returns {Promise<{ reply: Response, heygen: string, owner: string | null }>} */
  return async (
    method,
    route,
    body,
    headers = {},
    answers = null,
    label = `${method} ${route}`,
  ) => {
    let refused = "";
    for (;;) {
      // The refused token is passed on: the account renews only past a token it is told the server refused.
      const signedIn = await access(refused || undefined).catch((error) => {
        throw error instanceof AccountUnreachable ? offline() : error;
      });
      if (!signedIn || signedIn.token === refused) throw signedOut();
      const sending = typeof body === "function" ? await body() : body;
      const reply = await send(signedIn, method, route, sending, headers, answers, label);
      if (reply.status !== 401 || refused)
        return { reply, heygen: signedIn.heygen, owner: signedIn.owner ?? null };
      refused = signedIn.token;
      await reply.body?.cancel().catch(() => {});
    }
  };
}
