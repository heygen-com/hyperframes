import type { Browser } from "puppeteer-core";
import { registerBrowserSessionCleanup } from "./launch.js";

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
  const {
    browserProxyArgs,
    createPublicOnlyProfile,
    logRefusal,
    pageServerDirectHost,
    startCaptureProxy,
  } = await import("@hyperframes/engine/public-network");
  const { rm } = await import("node:fs/promises");
  const proxy = await startCaptureProxy(null, logRefusal);
  let profile: Promise<string> | undefined;
  let released: Promise<void> | undefined;
  let stopWatching = () => {};
  const release = () =>
    (released ??= (async () => {
      stopWatching();
      await proxy.close();
      const userDataDir = await profile?.catch(() => undefined);
      if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    })());
  try {
    stopWatching = registerBrowserSessionCleanup(release);
    profile = createPublicOnlyProfile("hf-cli-profile-");
    const userDataDir = await profile;
    if (released) throw new Error("The CLI is stopping; Chrome was not launched.");
    const browser = await launch({
      args: browserProxyArgs(proxy.url, pageServerDirectHost(pageUrl)),
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
