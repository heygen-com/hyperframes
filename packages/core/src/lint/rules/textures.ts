import postcss from "postcss";
import type { LintContext, HyperframeLintFinding, OpenTag } from "../context";
import { readAttr, truncateSnippet } from "../utils";

const TEXTURE_BASE_CLASS = "hf-texture-text";
const TEXTURE_CLASS_PREFIX = "hf-texture-";

type DropShadowRule = {
  selector: string;
  directlyTargetsTexture: boolean;
};

function classNames(tag: OpenTag): string[] {
  return (readAttr(tag.raw, "class") ?? "").split(/\s+/).filter(Boolean);
}

function isTextureMaterialClass(className: string): boolean {
  return className.startsWith(TEXTURE_CLASS_PREFIX) && className !== TEXTURE_BASE_CLASS;
}

function hasInlineMaskImage(tag: OpenTag): boolean {
  const style = readAttr(tag.raw, "style") ?? "";
  return /\b(?:-webkit-)?mask-image\s*:/i.test(style);
}

function hasInlineDropShadow(tag: OpenTag): boolean {
  const style = readAttr(tag.raw, "style") ?? "";
  return /\bfilter\s*:\s*[^;]*\bdrop-shadow\s*\(/i.test(style);
}

function classNamesInSelector(selector: string): string[] {
  const classes = new Set<string>();
  const pattern = /\.([A-Za-z_][\w-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(selector)) !== null) {
    const className = match[1];
    if (!className) continue;
    classes.add(className);
  }
  return [...classes];
}

function textureClassesInSelector(selector: string): string[] {
  return classNamesInSelector(selector).filter(isTextureMaterialClass);
}

function simpleSelectorMatchesTag(selector: string, tag: OpenTag, tagClasses: string[]): boolean {
  const trimmed = selector.trim();
  const simpleSelectorPattern = /^(?:[A-Za-z][\w-]*)?(?:\.[A-Za-z_][\w-]*)+$/;
  if (!simpleSelectorPattern.test(trimmed)) return false;

  const typeMatch = /^([A-Za-z][\w-]*)/.exec(trimmed);
  if (typeMatch && typeMatch[1]!.toLowerCase() !== tag.name) return false;

  const selectorClasses = classNamesInSelector(trimmed);
  return (
    selectorClasses.length > 0 &&
    selectorClasses.every((className) => tagClasses.includes(className))
  );
}

function collectTextureCss(styles: LintContext["styles"]): {
  definedTextureClasses: Set<string>;
  dropShadowRules: DropShadowRule[];
} {
  const definedTextureClasses = new Set<string>();
  const dropShadowRules: DropShadowRule[] = [];
  const roots: postcss.Root[] = [];

  for (const style of styles) {
    let root: postcss.Root;
    try {
      root = postcss.parse(style.content);
    } catch {
      continue;
    }
    roots.push(root);

    root.walkRules((rule) => {
      const selectors = rule.selectors ?? [];
      let hasMaskImage = false;

      for (const node of rule.nodes ?? []) {
        if (node.type !== "decl") continue;
        const prop = node.prop.toLowerCase();
        if (prop === "mask-image" || prop === "-webkit-mask-image") hasMaskImage = true;
      }

      if (hasMaskImage) {
        for (const selector of selectors) {
          for (const className of textureClassesInSelector(selector)) {
            definedTextureClasses.add(className);
          }
        }
      }
    });
  }

  for (const root of roots) {
    root.walkRules((rule) => {
      const selectors = rule.selectors ?? [];
      let hasDropShadow = false;

      for (const node of rule.nodes ?? []) {
        if (node.type !== "decl") continue;
        if (node.prop.toLowerCase() === "filter" && /\bdrop-shadow\s*\(/i.test(node.value)) {
          hasDropShadow = true;
        }
      }

      if (hasDropShadow) {
        for (const selector of selectors) {
          const targetsBaseClass = /\.hf-texture-text\b/.test(selector);
          const targetsDefinedTextureClass = textureClassesInSelector(selector).some((className) =>
            definedTextureClasses.has(className),
          );
          dropShadowRules.push({
            selector,
            directlyTargetsTexture: targetsBaseClass || targetsDefinedTextureClass,
          });
        }
      }
    });
  }

  return { definedTextureClasses, dropShadowRules };
}

export const textureRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  ({ tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const { definedTextureClasses, dropShadowRules } = collectTextureCss(styles);

    for (const { selector, directlyTargetsTexture } of dropShadowRules) {
      if (!directlyTargetsTexture) continue;
      findings.push({
        code: "texture_drop_shadow_on_text",
        severity: "warning",
        message: "Drop shadow is applied directly to textured text.",
        selector,
        fixHint:
          "Wrap the textured text and apply `filter: drop-shadow(...)` to the wrapper, not the `hf-texture-text` element.",
      });
    }

    for (const tag of tags) {
      if (tag.name === "style" || tag.name === "script") continue;

      const classes = classNames(tag);
      if (classes.length === 0) continue;

      const hasBaseClass = classes.includes(TEXTURE_BASE_CLASS);
      const textureClasses = classes.filter(isTextureMaterialClass);

      if (textureClasses.length > 0 && !hasBaseClass) {
        findings.push({
          code: "texture_class_missing_base",
          severity: "warning",
          message: `Texture material class \`${textureClasses[0]}\` is used without \`${TEXTURE_BASE_CLASS}\`.`,
          elementId: readAttr(tag.raw, "id") || undefined,
          fixHint: `Add \`${TEXTURE_BASE_CLASS}\` alongside the material class, for example \`class="${TEXTURE_BASE_CLASS} ${textureClasses[0]}"\`.`,
          snippet: truncateSnippet(tag.raw),
        });
      }

      if (hasBaseClass && textureClasses.length === 0 && !hasInlineMaskImage(tag)) {
        findings.push({
          code: "texture_text_missing_mask",
          severity: "warning",
          message: `\`${TEXTURE_BASE_CLASS}\` is used without a texture material class or custom mask image.`,
          elementId: readAttr(tag.raw, "id") || undefined,
          fixHint:
            "Add a material class such as `hf-texture-lava`, or set `mask-image` and `-webkit-mask-image` on the element.",
          snippet: truncateSnippet(tag.raw),
        });
      }

      for (const textureClass of textureClasses) {
        if (definedTextureClasses.has(textureClass)) continue;
        findings.push({
          code: "texture_class_unknown",
          severity: "warning",
          message: `Texture material class \`${textureClass}\` is not defined by local CSS.`,
          elementId: readAttr(tag.raw, "id") || undefined,
          fixHint:
            "Paste the Texture Mask Text component `<style>...</style>` block into the composition, or fix the texture class typo.",
          snippet: truncateSnippet(tag.raw),
        });
      }

      if (hasBaseClass) {
        for (const rule of dropShadowRules) {
          if (rule.directlyTargetsTexture) continue;
          if (!simpleSelectorMatchesTag(rule.selector, tag, classes)) continue;
          findings.push({
            code: "texture_drop_shadow_on_text",
            severity: "warning",
            message: "Drop shadow is applied directly to textured text.",
            selector: rule.selector,
            elementId: readAttr(tag.raw, "id") || undefined,
            fixHint:
              "Wrap the textured text and apply `filter: drop-shadow(...)` to the wrapper, not the `hf-texture-text` element.",
            snippet: truncateSnippet(tag.raw),
          });
        }
      }

      if (hasBaseClass && hasInlineDropShadow(tag)) {
        findings.push({
          code: "texture_drop_shadow_on_text",
          severity: "warning",
          message: "Drop shadow is applied directly to textured text.",
          elementId: readAttr(tag.raw, "id") || undefined,
          fixHint:
            "Wrap the textured text and apply `filter: drop-shadow(...)` to the wrapper, not the `hf-texture-text` element.",
          snippet: truncateSnippet(tag.raw),
        });
      }
    }

    return findings;
  },
];
