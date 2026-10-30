import type { Browser } from "puppeteer-core";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  launchManagedBrowser,
  closeManagedBrowser,
  registerBrowserSessionCleanup,
} from "../browser/launch.js";
import { captureBrowserArgs } from "./browserLaunchArgs.js";
import { settleAcrossNavigation } from "./navigateForCapture.js";
import { startCaptureProxy } from "./captureProxy.js";
import { removeTreeBestEffortAsync } from "@hyperframes/core/remove-tree";

/** The launch-wide proxy covers pages, popups, workers and both extraction passes. */
export async function launchCaptureBrowser(options: {
  executablePath: string;
  protocolTimeout: number;
  disableWebgl: boolean;
  width: number;
  height: number;
  localOrigin?: string;
}): Promise<{ browser: Browser; close(): Promise<void> }> {
  const proxy = await startCaptureProxy();
  let profile: string | undefined;
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;
  let unregister: (() => void) | undefined;
  const close = () => {
    closing ??= (async () => {
      try {
        await proxy.close();
        if (browser) await closeManagedBrowser(browser);
      } finally {
        try {
          if (profile) await removeTreeBestEffortAsync(profile);
        } finally {
          unregister?.();
        }
      }
    })();
    return closing;
  };
  try {
    const profilePath = await mkdtemp(join(tmpdir(), "hf-capture-profile-"));
    profile = profilePath;
    await mkdir(join(profile, "Default"));
    await writeFile(
      join(profile, "Default", "Preferences"),
      JSON.stringify({
        webrtc: { ip_handling_policy: "disable_non_proxied_udp" },
      }),
    );
    unregister = registerBrowserSessionCleanup(close);
    const puppeteer = await import("puppeteer-core");
    browser = await launchManagedBrowser(puppeteer.default, {
      headless: true,
      userDataDir: profile,
      executablePath: options.executablePath,
      protocolTimeout: options.protocolTimeout,
      // Linux containers may lack the user namespaces Chromium's sandbox requires.
      args: [
        ...captureBrowserArgs(options.disableWebgl, options.width, options.height),
        `--proxy-server=${proxy.url}`,
        `--proxy-bypass-list=<-loopback>${options.localOrigin ? `;${new URL(options.localOrigin).host}` : ""}`,
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async () => settleAcrossNavigation(await newPage());
    browser.once("disconnected", () => void proxy.close());
    return {
      browser,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
