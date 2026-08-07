import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compareCodePoints, isRecord } from "./scope.js";

const APPROVED_TOKEN_PAYLOAD_SHA256 =
  "95f39d7b7617ed2229610706b4f40882746246a7f772db98e3df19af0b2f7439";

export const TOKEN_START = "/* hf-ui:tokens:start */";
export const TOKEN_END = "/* hf-ui:tokens:end */";

export interface OperatorBlackTokens {
  version: 1;
  name: "operator-black";
  shared: Record<string, string>;
  themes: {
    dark: Record<string, string>;
    light: Record<string, string>;
  };
}

function parseTokenMap(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  const result: Record<string, string> = {};
  for (const [name, fallback] of Object.entries(value)) {
    if (!name.startsWith("--hf-ui-")) {
      throw new Error(`${field} token ${name} must use the --hf-ui- prefix`);
    }
    if (typeof fallback !== "string" || fallback.length === 0) {
      throw new Error(`${field} token ${name} must have a non-empty string fallback`);
    }
    result[name] = fallback;
  }
  if (Object.keys(result).length === 0) throw new Error(`${field} must not be empty`);
  return result;
}

function sortedTokenMap(tokens: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).sort(([left], [right]) => compareCodePoints(left, right)),
  );
}

export function parseOperatorBlackTokens(value: unknown, source = "tokens"): OperatorBlackTokens {
  if (!isRecord(value)) throw new Error(`${source} must be an object`);
  const keys = Object.keys(value).sort(compareCodePoints);
  if (JSON.stringify(keys) !== JSON.stringify(["name", "shared", "themes", "version"])) {
    throw new Error(`${source} keys must be exactly: name, shared, themes, version`);
  }
  if (value.version !== 1) throw new Error(`${source} version must be 1`);
  if (value.name !== "operator-black") throw new Error(`${source} name must be operator-black`);
  if (!isRecord(value.themes)) throw new Error(`${source} themes must be an object`);
  const themeKeys = Object.keys(value.themes).sort(compareCodePoints);
  if (JSON.stringify(themeKeys) !== JSON.stringify(["dark", "light"])) {
    throw new Error(`${source} themes must contain exactly dark and light`);
  }

  const shared = parseTokenMap(value.shared, `${source}.shared`);
  const dark = parseTokenMap(value.themes.dark, `${source}.themes.dark`);
  const light = parseTokenMap(value.themes.light, `${source}.themes.light`);
  const darkKeys = Object.keys(dark).sort(compareCodePoints);
  const lightKeys = Object.keys(light).sort(compareCodePoints);
  if (JSON.stringify(darkKeys) !== JSON.stringify(lightKeys)) {
    throw new Error(`${source} dark and light theme token keys must match`);
  }
  for (const name of Object.keys(shared)) {
    if (name in dark) throw new Error(`${source} token ${name} is duplicated across shared/themes`);
  }
  const payload = {
    shared: sortedTokenMap(shared),
    themes: { dark: sortedTokenMap(dark), light: sortedTokenMap(light) },
  };
  const payloadSha = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (payloadSha !== APPROVED_TOKEN_PAYLOAD_SHA256) {
    throw new Error(`${source} does not match the approved Operator Black token contract`);
  }

  return { version: 1, name: "operator-black", shared, themes: { dark, light } };
}

export function loadOperatorBlackTokens(path: string): OperatorBlackTokens {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parseOperatorBlackTokens(parsed, path);
}

function privateName(publicName: string): string {
  return publicName.replace(/^--hf-ui-/, "--_hf-ui-");
}

function renderAssignments(tokens: Record<string, string>, indent: string): string[] {
  return Object.keys(tokens)
    .sort(compareCodePoints)
    .map((name) => `${indent}${privateName(name)}: var(${name}, ${tokens[name]});`);
}

export function renderOperatorBlackTokenBlock(tokens: OperatorBlackTokens): string {
  const darkAndShared = { ...tokens.shared, ...tokens.themes.dark };
  const lines = [
    TOKEN_START,
    "/* prettier-ignore */",
    "[data-hf-ui-root] {",
    ...renderAssignments(darkAndShared, "  "),
    "  box-sizing: border-box;",
    "  color-scheme: dark;",
    "  font-family: var(--_hf-ui-font-sans);",
    "}",
    "/* prettier-ignore */",
    "[data-hf-ui-root] *,",
    "[data-hf-ui-root] *::before,",
    "[data-hf-ui-root] *::after {",
    "  box-sizing: border-box;",
    "}",
    "/* prettier-ignore */",
    '[data-hf-theme="light"] [data-hf-ui-root],',
    '[data-hf-ui-root][data-hf-theme="light"] {',
    ...renderAssignments(tokens.themes.light, "  "),
    "  color-scheme: light;",
    "}",
    "/* prettier-ignore */",
    "[data-hf-ui-root]:focus-visible {",
    "  outline: 2px solid var(--_hf-ui-accent);",
    "  outline-offset: 3px;",
    "}",
    "/* prettier-ignore */",
    '[data-hf-rendering="true"][data-hf-ui-root],',
    '[data-hf-rendering="true"] [data-hf-ui-root],',
    '[data-hf-rendering="true"][data-hf-ui-root] *,',
    '[data-hf-rendering="true"] [data-hf-ui-root] *,',
    '[data-hf-rendering="true"][data-hf-ui-root]::before,',
    '[data-hf-rendering="true"][data-hf-ui-root]::after,',
    '[data-hf-rendering="true"] [data-hf-ui-root]::before,',
    '[data-hf-rendering="true"] [data-hf-ui-root]::after,',
    '[data-hf-rendering="true"][data-hf-ui-root] *::before,',
    '[data-hf-rendering="true"][data-hf-ui-root] *::after,',
    '[data-hf-rendering="true"] [data-hf-ui-root] *::before,',
    '[data-hf-rendering="true"] [data-hf-ui-root] *::after {',
    "  animation-duration: 0s !important;",
    "  animation-delay: 0s !important;",
    "  transition-duration: 0s !important;",
    "  transition-delay: 0s !important;",
    "}",
    "/* prettier-ignore */",
    "@media (prefers-reduced-motion: reduce) {",
    "  [data-hf-ui-root],",
    "  [data-hf-ui-root] *,",
    "  [data-hf-ui-root] *::before,",
    "  [data-hf-ui-root] *::after {",
    "    animation-duration: 0s !important;",
    "    animation-delay: 0s !important;",
    "    transition-duration: 0s !important;",
    "    transition-delay: 0s !important;",
    "    scroll-behavior: auto !important;",
    "  }",
    "}",
    TOKEN_END,
  ];
  return lines.map((line) => `  ${line}`).join("\n");
}
