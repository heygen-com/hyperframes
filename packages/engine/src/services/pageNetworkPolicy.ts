import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { CDPSession, Page, Protocol } from "puppeteer-core";
import { isBlockedNetworkHost } from "../utils/networkPolicy.js";

type ResolveHost = (hostname: string) => Promise<string[]>;

const systemResolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);

async function isPublicHost(hostname: string, resolveHost: ResolveHost): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isBlockedNetworkHost(host)) return false;
  if (isIP(host)) return true;
  try {
    const addresses = await resolveHost(host);
    return addresses.length > 0 && !addresses.some((a) => isBlockedNetworkHost(a.split("%")[0]!));
  } catch {
    return false;
  }
}

/**
 * The page reaches only its own server and public addresses (the asset downloader's rule, by host and by
 * resolved address). Install before navigation; a refused request fails with net::ERR_BLOCKED_BY_CLIENT.
 */
export async function restrictPageNetwork(
  page: Page,
  allowedOrigin: string,
  resolveHost: ResolveHost = systemResolveHost,
): Promise<void> {
  const own = new URL(allowedOrigin).origin;
  const verdicts = new Map<string, Promise<boolean>>();
  const allows = (url: string): Promise<boolean> => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return Promise.resolve(false);
    }
    if (target.origin === own || !/^(https?|wss?):$/.test(target.protocol)) {
      return Promise.resolve(true);
    }
    let verdict = verdicts.get(target.hostname);
    if (!verdict) {
      verdict = isPublicHost(target.hostname, resolveHost);
      verdicts.set(target.hostname, verdict);
    }
    return verdict;
  };
  const client: CDPSession = await page.createCDPSession();
  client.on("Fetch.requestPaused", (event: Protocol.Fetch.RequestPausedEvent) => {
    void allows(event.request.url).then((allowed) => {
      const settled = allowed
        ? client.send("Fetch.continueRequest", { requestId: event.requestId })
        : client.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
      // A page closed mid-request rejects the reply; there is nothing left to settle.
      return settled.catch(() => undefined);
    });
  });
  await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
}
