/**
 * Open a URL in the user's default browser. Falls back to printing the
 * URL when no browser is openable (SSH session, CI, `BROWSER=none`,
 * or `open` rejects).
 */

import { c } from "../ui/colors.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";

export interface OpenBrowserResult {
  /** True when we successfully invoked the platform "open" command. */
  opened: boolean;
}

export async function openBrowser(url: string): Promise<OpenBrowserResult> {
  if (process.env["BROWSER"] === "none" || process.env["HF_NO_BROWSER"] === "1") {
    printManualInstructions(url);
    return { opened: false };
  }
  try {
    const open = (await import("open")).default;
    await open(url);
    return { opened: true };
  } catch (err) {
    printManualInstructions(url, normalizeErrorMessage(err));
    return { opened: false };
  }
}

function printManualInstructions(url: string, detail?: string): void {
  if (detail) {
    console.error(c.warn(`Could not open browser automatically (${detail}).`));
  } else {
    console.error(c.warn("Browser auto-open is disabled."));
  }
  console.error(`Open this URL manually to continue:\n  ${c.accent(url)}`);
}
