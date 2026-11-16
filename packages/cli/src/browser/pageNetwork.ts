import type { Browser } from "puppeteer-core";

export interface PageNetworkLaunch {
  /** Chrome args to add to the launch. Empty when the page network isn't restricted. */
  args: string[];
  userDataDir?: string;
}

/**
 * `PRODUCER_RESTRICT_PAGE_NETWORK` holds for every CLI browser that opens a composition, as it does for a render.
 * The page reaches its own server (`pageUrl`'s host) directly. Everything else goes through the engine's
 * public-only proxy, which refuses loopback, private, link-local and other non-public addresses. The proxy and
 * profile live as long as the browser. If the proxy can't start, the launch fails rather than running the page
 * unrestricted.
 */
export async function launchWithPageNetwork(
  pageUrl: string | undefined,
  launch: (network: PageNetworkLaunch) => Promise<Browser>,
): Promise<Browser> {
  const { resolveRestrictPageNetwork } = await import("@hyperframes/engine");
  if (!resolveRestrictPageNetwork()) return launch({ args: [] });
  if (!pageUrl)
    throw new Error("A restricted page network needs the page's URL before Chrome launches.");
  const { browserProxyArgs, createPublicOnlyProfile, logRefusal, startCaptureProxy } =
    await import("@hyperframes/engine/public-network");
  const { rm } = await import("node:fs/promises");
  const proxy = await startCaptureProxy(null, logRefusal);
  let userDataDir: string | undefined;
  const release = async () => {
    await proxy.close();
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  };
  try {
    userDataDir = await createPublicOnlyProfile("hf-cli-profile-");
    const browser = await launch({
      args: browserProxyArgs(proxy.url, new URL(pageUrl).host),
      userDataDir,
    });
    if (browser.connected) browser.once("disconnected", () => void release());
    else await release();
    return browser;
  } catch (error) {
    await release();
    throw error;
  }
}
