import type { Browser } from "puppeteer-core";
import {
  launchManagedBrowser,
  closeManagedBrowser,
  registerBrowserSessionCleanup,
} from "../browser/launch.js";
import { captureBrowserArgs } from "./browserLaunchArgs.js";
import { settleAcrossNavigation } from "./navigateForCapture.js";
import {
  browserProxyArgs,
  createPublicOnlyProfile,
  pageServerDirectHost,
  startCaptureProxy,
} from "@hyperframes/engine/public-network";
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
    profile = await createPublicOnlyProfile("hf-capture-profile-");
    unregister = registerBrowserSessionCleanup(close);
    const puppeteer = await import("puppeteer-core");
    browser = await launchManagedBrowser(puppeteer.default, {
      headless: true,
      userDataDir: profile,
      executablePath: options.executablePath,
      protocolTimeout: options.protocolTimeout,
      args: [
        ...captureBrowserArgs(options.disableWebgl, options.width, options.height),
        ...browserProxyArgs(
          proxy.url,
          options.localOrigin ? pageServerDirectHost(options.localOrigin) : undefined,
        ),
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
