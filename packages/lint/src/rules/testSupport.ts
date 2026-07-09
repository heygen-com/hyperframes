import { lintHyperframeHtml } from "../hyperframeLinter.js";
import type { HyperframeLinterOptions } from "../types.js";

export async function findByCode(
  html: string,
  code: string,
  options: HyperframeLinterOptions = {},
) {
  const result = await lintHyperframeHtml(html, options);
  return result.findings.filter((f) => f.code === code);
}
