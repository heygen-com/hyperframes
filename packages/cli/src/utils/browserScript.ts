import { cssColorAlpha } from "@hyperframes/core/visual-paint";

const LAYOUT_AUDIT_SCRIPT = "layout-audit.browser.js";
const COLOR_ALPHA_BINDING = "__hyperframesCssColorAlpha";

/**
 * Inject shared paint primitives into scripts that must execute without module imports.
 * The outer scope is private and disappears after the audit installs its window hooks.
 */
export function prepareBrowserScript(name: string, source: string): string {
  if (name !== LAYOUT_AUDIT_SCRIPT) return source;
  const serializedColorAlpha = cssColorAlpha.toString();
  return `(function () {\nconst ${COLOR_ALPHA_BINDING} = ${serializedColorAlpha};\n${source}\n})();`;
}
