import type { LintContext, HyperframeLintFinding } from "../context";
import { findHtmlTag, readJsonAttr } from "../utils";
import { isRegistrySourceFile } from "./composition";

function shouldEnforceVariableContract(ctx: LintContext): boolean {
  return (
    ctx.options.enforceThemeTokenContract === true || isRegistrySourceFile(ctx.options.filePath)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : null;
}

function removeFirst(haystack: string, needle: string): string {
  const index = haystack.indexOf(needle);
  if (index === -1) return haystack;
  return `${haystack.slice(0, index)} ${haystack.slice(index + needle.length)}`;
}

function readDeclaredVariableIds(source: string): { attrValue: string; ids: string[] } | null {
  const htmlTag = findHtmlTag(source);
  if (!htmlTag) return null;
  const attrValue = readJsonAttr(htmlTag.raw, "data-composition-variables");
  if (!attrValue) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(attrValue);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const ids: string[] = [];
  for (const entry of parsed) {
    const id = getStringProperty(entry, "id");
    if (id && !ids.includes(id)) ids.push(id);
  }

  return { attrValue, ids };
}

export const variableRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // composition_variable_unused
  (ctx) => {
    if (!shouldEnforceVariableContract(ctx)) return [];

    const declared = readDeclaredVariableIds(ctx.source);
    if (!declared || declared.ids.length === 0) return [];

    const sourceWithoutDeclaration = removeFirst(ctx.rawSource, declared.attrValue);
    const findings: HyperframeLintFinding[] = [];
    for (const id of declared.ids) {
      const idPattern = new RegExp(`\\b${escapeRegExp(id)}\\b`);
      if (idPattern.test(sourceWithoutDeclaration)) continue;

      findings.push({
        code: "composition_variable_unused",
        severity: "warning",
        message:
          `Composition variable "${id}" is declared but never consumed outside data-composition-variables. ` +
          "This creates metadata/implementation drift: changing the variable has no visible effect.",
        fixHint:
          "Wire the variable into the script/CSS that should use it, or remove the unused declaration.",
      });
    }

    return findings;
  },
];
