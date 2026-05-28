import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const themeDir = path.join(projectRoot, "assets", "vscode-themes");
const outFile = path.join(projectRoot, "assets", "vscode-theme-registry.js");

const themeEntries = [
  ["light-2026", "Light 2026", "2026-light.json"],
  ["dark-2026", "Dark 2026", "2026-dark.json"],
  ["dark-plus", "Dark+", "dark_plus.json"],
  ["dark-modern", "Dark Modern", "dark_modern.json"],
  ["light-plus", "Light+", "light_plus.json"],
  ["light-modern", "Light Modern", "light_modern.json"],
  ["visual-studio-dark", "Visual Studio Dark", "dark_vs.json"],
  ["visual-studio-light", "Visual Studio Light", "light_vs.json"],
  ["high-contrast", "Default High Contrast", "hc_black.json"],
  ["high-contrast-light", "Default High Contrast Light", "hc_light.json"],
  ["solarized-light", "Solarized Light", "solarized-light-color-theme.json"],
  ["monokai", "Monokai", "monokai-color-theme.json"],
];

const workbenchKeys = [
  "activityBar.activeBorder",
  "activityBar.background",
  "activityBar.border",
  "activityBar.foreground",
  "activityBar.inactiveForeground",
  "editor.background",
  "editor.foreground",
  "editor.lineHighlightBackground",
  "editor.selectionBackground",
  "editorGroup.border",
  "editorGroupHeader.tabsBackground",
  "editorGroupHeader.tabsBorder",
  "editorLineNumber.activeForeground",
  "editorLineNumber.foreground",
  "foreground",
  "icon.foreground",
  "panel.background",
  "panel.border",
  "sideBar.background",
  "sideBar.border",
  "sideBar.foreground",
  "sideBarSectionHeader.background",
  "sideBarSectionHeader.border",
  "sideBarSectionHeader.foreground",
  "sideBarTitle.foreground",
  "statusBar.background",
  "statusBar.border",
  "statusBar.foreground",
  "statusBarItem.remoteBackground",
  "statusBarItem.remoteForeground",
  "tab.activeBackground",
  "tab.activeBorder",
  "tab.activeBorderTop",
  "tab.activeForeground",
  "tab.border",
  "tab.inactiveBackground",
  "tab.inactiveForeground",
  "terminal.background",
  "terminal.foreground",
  "terminalCursor.foreground",
  "titleBar.activeBackground",
  "titleBar.activeForeground",
];

const tokenScopes = {
  comment: ["comment", "punctuation.definition.comment"],
  keyword: ["keyword", "storage", "storage.type"],
  function: ["entity.name.function", "support.function"],
  string: ["string", "punctuation.definition.string"],
  number: ["constant.numeric"],
  variable: ["variable", "variable.other"],
  parameter: ["variable.parameter", "meta.function.parameters"],
  operator: ["keyword.operator"],
  punctuation: ["punctuation", "meta.brace"],
  className: ["entity.name.type", "support.class", "support.type"],
};

const fallbackColors = {
  comment: "#6A9955",
  keyword: "#C586C0",
  function: "#DCDCAA",
  string: "#CE9178",
  number: "#B5CEA8",
  variable: "#9CDCFE",
  parameter: "#9CDCFE",
  operator: "#D4D4D4",
  punctuation: "#D4D4D4",
  className: "#4EC9B0",
};

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (inString) {
      output += char;
      escaped = char === "\\" && !escaped;
      if (char === '"' && !escaped) inString = false;
      if (char !== "\\") escaped = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function stripTrailingCommas(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      output += char;
      escaped = char === "\\" && !escaped;
      if (char === '"' && !escaped) inString = false;
      if (char !== "\\") escaped = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let j = i + 1;
      while (/\s/.test(source[j])) j += 1;
      if (source[j] === "}" || source[j] === "]") continue;
    }
    output += char;
  }
  return output;
}

function readTheme(fileName, seen = new Set()) {
  const filePath = path.join(themeDir, fileName);
  if (seen.has(filePath)) throw new Error(`Circular theme include: ${fileName}`);
  seen.add(filePath);

  const raw = fs.readFileSync(filePath, "utf8");
  const theme = JSON.parse(stripTrailingCommas(stripJsonComments(raw)));
  let parent = { colors: {}, tokenColors: [], semanticTokenColors: {} };

  if (theme.include) {
    parent = readTheme(path.basename(theme.include), seen);
  }

  return {
    name: theme.name || parent.name,
    type: theme.type || parent.type,
    colors: { ...parent.colors, ...(theme.colors || {}) },
    tokenColors: [...(parent.tokenColors || []), ...(theme.tokenColors || [])],
    semanticTokenColors: {
      ...(parent.semanticTokenColors || {}),
      ...(theme.semanticTokenColors || {}),
    },
  };
}

function scopeList(scope) {
  if (!scope) return [];
  if (Array.isArray(scope)) return scope;
  return String(scope)
    .split(",")
    .map((item) => item.trim());
}

function scopeMatches(actual, wanted) {
  return actual === wanted || actual.startsWith(`${wanted}.`) || wanted.startsWith(`${actual}.`);
}

function findTokenColor(theme, wantedScopes) {
  for (let i = theme.tokenColors.length - 1; i >= 0; i -= 1) {
    const tokenColor = theme.tokenColors[i];
    const foreground = tokenColor.settings?.foreground;
    if (!foreground) continue;
    const scopes = scopeList(tokenColor.scope);
    if (scopes.some((scope) => wantedScopes.some((wanted) => scopeMatches(scope, wanted)))) {
      return foreground;
    }
  }
  return null;
}

function pickColors(colors) {
  const picked = {};
  for (const key of workbenchKeys) {
    if (colors[key]) picked[key] = colors[key];
  }
  return picked;
}

const registry = themeEntries.map(([id, label, file]) => {
  const theme = readTheme(file);
  const tokens = {};
  for (const [tokenName, scopes] of Object.entries(tokenScopes)) {
    tokens[tokenName] = findTokenColor(theme, scopes) || fallbackColors[tokenName];
  }

  return {
    id,
    label,
    sourceFile: file,
    uiTheme: file.includes("light") || file.includes("2026-light") ? "vs" : "vs-dark",
    colors: pickColors(theme.colors),
    tokens,
  };
});

const generated = `// Generated by scripts/build-theme-registry.mjs from official VS Code theme JSON.\nwindow.VSCODE_THEME_REGISTRY = ${JSON.stringify(registry, null, 2)};\n`;

fs.writeFileSync(outFile, generated);
console.log(`Wrote ${path.relative(projectRoot, outFile)} with ${registry.length} themes`);
