import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { rewriteAssetPaths, rewriteCssAssetUrls } from "../../compiler/rewriteSubCompPaths.js";

/**
 * Build a standalone HTML page for a sub-composition.
 *
 * Uses the project's own index.html `<head>` so all dependencies (GSAP, fonts,
 * Lottie, reset styles, runtime) are preserved — instead of building a minimal
 * page from scratch that would miss important scripts/styles.
 */
export function buildSubCompositionHtml(
  projectDir: string,
  compPath: string,
  runtimeUrl: string,
  baseHref?: string,
): string | null {
  const compFile = join(projectDir, compPath);
  if (!existsSync(compFile)) return null;

  const rawComp = readFileSync(compFile, "utf-8");

  // Extract content from <template> wrapper (compositions are always templates)
  const templateMatch = rawComp.match(/<template[^>]*>([\s\S]*)<\/template>/i);
  const content = templateMatch?.[1] ?? rawComp;
  const { document: contentDoc } = parseHTML(
    `<!DOCTYPE html><html><head></head><body>${content}</body></html>`,
  );

  rewriteAssetPaths(
    contentDoc.querySelectorAll("[src], [href]"),
    compPath,
    (el: Element, attr: string) => el.getAttribute(attr),
    (el: Element, attr: string, value: string) => {
      el.setAttribute(attr, value);
    },
  );
  for (const styleEl of contentDoc.querySelectorAll("style")) {
    styleEl.textContent = rewriteCssAssetUrls(styleEl.textContent || "", compPath);
  }

  const rewrittenContent = contentDoc.body.innerHTML || content;

  // Use the project's index.html <head> to preserve all dependencies
  const indexPath = join(projectDir, "index.html");
  let headContent = "";

  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, "utf-8");
    const headMatch = indexHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    headContent = headMatch?.[1] ?? "";
  }

  // Inject <base> for relative asset resolution (before other tags)
  if (baseHref && !headContent.includes("<base")) {
    headContent = `<base href="${baseHref}">\n${headContent}`;
  }

  // Ensure runtime is present (might differ from the one in index.html)
  if (
    !headContent.includes("hyperframe.runtime") &&
    !headContent.includes("hyperframes-preview-runtime")
  ) {
    headContent += `\n<script data-hyperframes-preview-runtime="1" src="${runtimeUrl}"></script>`;
  }

  // Fallback: if no index.html head was found, add minimal deps
  if (!headContent.includes("gsap")) {
    headContent += `\n<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
${headContent}
</head>
<body>
<script>window.__timelines=window.__timelines||{};</script>
${rewrittenContent}
</body>
</html>`;
}
