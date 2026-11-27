import { HtmlReadUnlikeBrowserError, parseHTML } from "@hyperframes/parsers/linkedom";
import type { HyperframeLintFinding } from "./types.js";

export function htmlReadUnlikeBrowserFinding(html: string): HyperframeLintFinding | null {
  try {
    parseHTML(html);
    return null;
  } catch (error) {
    if (!(error instanceof HtmlReadUnlikeBrowserError)) throw error;
    return {
      code: "html_read_unlike_browser",
      severity: "error",
      message: error.message,
      fixHint:
        "Take the tags or comments out of the element the message names. Preview and render refuse this file until then.",
    };
  }
}

/** Reads a file the parser refuses as empty: its own html_read_unlike_browser finding reports it. */
export function parseLintHtml(html: string): ReturnType<typeof parseHTML> {
  try {
    return parseHTML(html);
  } catch (error) {
    if (error instanceof HtmlReadUnlikeBrowserError) return parseHTML("");
    throw error;
  }
}
