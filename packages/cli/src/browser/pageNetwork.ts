import type { Browser } from "puppeteer-core";

export interface PageNetworkLaunch {
  args: string[];
  userDataDir?: string;
}

// With PRODUCER_RESTRICT_PAGE_NETWORK on, a composition page reaches its own server directly and everything else
// only through the engine's public-only proxy, as in a render. If the proxy can't start, the launch fails.
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
