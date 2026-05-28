import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectRoot, "../../..");
const assetsDir = path.join(projectRoot, "assets");
const compositionsDir = path.join(projectRoot, "compositions");
const renderEntriesDir = path.join(projectRoot, "render-entries");
const blocksDir = path.join(repoRoot, "registry", "blocks");

fs.mkdirSync(compositionsDir, { recursive: true });
fs.mkdirSync(renderEntriesDir, { recursive: true });

const registrySource = fs.readFileSync(path.join(assetsDir, "vscode-theme-registry.js"), "utf8");
const registryBody = registrySource
  .replace(/^.*window\.VSCODE_THEME_REGISTRY\s*=\s*/s, "")
  .replace(/;\s*$/, "");
const registry = new Function("return (" + registryBody + ")")();
const clipDuration = 11;

const css = String.raw`* {
  box-sizing: border-box;
  letter-spacing: 0;
}

html,
body {
  margin: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: #000000;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.vscode-theme-scene {
  --activity-bg: #181818;
  --activity-fg: #d7d7d7;
  --activity-muted: #868686;
  --activity-active: #0078d4;
  --sidebar-bg: #181818;
  --sidebar-fg: #cccccc;
  --sidebar-border: #2b2b2b;
  --tab-bg: #181818;
  --tab-active-bg: #1f1f1f;
  --tab-active-fg: #ffffff;
  --tab-inactive-fg: #9d9d9d;
  --tab-border: #2b2b2b;
  --editor-bg: #1f1f1f;
  --editor-fg: #cccccc;
  --editor-line: rgba(255, 255, 255, 0.04);
  --gutter-fg: #6e7681;
  --gutter-active-fg: #cccccc;
  --panel-bg: #181818;
  --panel-border: #2b2b2b;
  --status-bg: #181818;
  --status-fg: #cccccc;
  --status-border: #2b2b2b;
  --title-bg: #181818;
  --title-fg: #cccccc;
  --token-comment: #6a9955;
  --token-keyword: #c586c0;
  --token-function: #dcdcaa;
  --token-string: #ce9178;
  --token-number: #b5cea8;
  --token-variable: #9cdcfe;
  --token-parameter: #9cdcfe;
  --token-operator: #d4d4d4;
  --token-punctuation: #d4d4d4;
  --token-class-name: #4ec9b0;
  position: relative;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0.32)),
    url("../assets/background.jpeg") center / cover no-repeat;
  color: var(--editor-fg);
}

.scene-content {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  padding: 54px 70px 92px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  perspective: 2200px;
  perspective-origin: 56% 52%;
}

.header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  min-height: 66px;
  text-shadow:
    0 2px 12px rgba(0, 0, 0, 0.42),
    0 14px 34px rgba(0, 0, 0, 0.32);
}

.kicker {
  margin: 0 0 7px;
  color: var(--gutter-fg);
  font-size: 15px;
  font-weight: 650;
  text-transform: uppercase;
  text-shadow:
    0 2px 8px rgba(0, 0, 0, 0.48),
    0 10px 26px rgba(0, 0, 0, 0.36);
}

.title {
  margin: 0;
  color: var(--editor-fg);
  font-size: 44px;
  line-height: 1;
  font-weight: 760;
}

.source-note {
  width: 510px;
  color: var(--gutter-fg);
  font-size: 16px;
  line-height: 1.35;
  text-align: right;
  text-shadow:
    0 2px 10px rgba(0, 0, 0, 0.46),
    0 12px 30px rgba(0, 0, 0, 0.34);
}

.workbench {
  height: 824px;
  display: grid;
  grid-template-columns: 54px 290px 1fr;
  grid-template-rows: 36px 1fr 26px;
  overflow: hidden;
  border: 1px solid var(--sidebar-border);
  border-radius: 8px;
  background: var(--editor-bg);
  box-shadow: 0 34px 90px rgba(0, 0, 0, 0.42);
  transform: translateZ(0);
  transform-origin: 82% 50%;
  transform-style: preserve-3d;
  will-change: transform;
}

.titlebar {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 120px 1fr 210px;
  align-items: center;
  background: var(--title-bg);
  color: var(--title-fg);
  border-bottom: 1px solid var(--tab-border);
  font-size: 12px;
}

.traffic {
  display: flex;
  gap: 8px;
  padding-left: 18px;
}

.traffic span {
  width: 12px;
  height: 12px;
  border-radius: 999px;
}

.traffic span:nth-child(1) { background: #ff5f57; }
.traffic span:nth-child(2) { background: #ffbd2e; }
.traffic span:nth-child(3) { background: #28c840; }

.window-title {
  justify-self: center;
  opacity: 0.84;
}

.command-center {
  justify-self: end;
  width: 176px;
  height: 22px;
  margin-right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--title-fg), transparent 78%);
  border-radius: 5px;
  color: color-mix(in srgb, var(--title-fg), transparent 18%);
}

.activity {
  grid-row: 2 / 3;
  background: var(--activity-bg);
  border-right: 1px solid var(--sidebar-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
  gap: 18px;
}

.activity-icon {
  width: 28px;
  height: 28px;
  color: var(--activity-muted);
}

.activity-icon.active {
  color: var(--activity-fg);
  border-left: 2px solid var(--activity-active);
  padding-left: 4px;
}

.sidebar {
  grid-row: 2 / 3;
  background: var(--sidebar-bg);
  color: var(--sidebar-fg);
  border-right: 1px solid var(--sidebar-border);
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sidebar-title {
  height: 38px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  color: var(--sidebar-fg);
  font-size: 11px;
  text-transform: uppercase;
}

.section-title {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  background: color-mix(in srgb, var(--sidebar-bg), var(--sidebar-fg) 5%);
  border-top: 1px solid var(--sidebar-border);
  border-bottom: 1px solid var(--sidebar-border);
  color: var(--sidebar-fg);
  font-size: 11px;
  font-weight: 700;
}

.tree {
  padding: 8px 0;
  font-size: 13px;
  line-height: 24px;
}

.tree-row {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px 0 18px;
  color: color-mix(in srgb, var(--sidebar-fg), transparent 8%);
  white-space: nowrap;
}

.tree-row.child {
  padding-left: 34px;
}

.tree-row.selected {
  background: color-mix(in srgb, var(--sidebar-fg), transparent 88%);
  color: var(--sidebar-fg);
}

.editor-area {
  grid-row: 2 / 3;
  display: grid;
  grid-template-rows: 36px 30px 1fr 138px;
  min-width: 0;
  background: var(--editor-bg);
}

.tabs {
  display: flex;
  background: var(--tab-bg);
  border-bottom: 1px solid var(--tab-border);
}

.tab {
  width: 205px;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 13px;
  border-right: 1px solid var(--tab-border);
  background: var(--tab-active-bg);
  color: var(--tab-active-fg);
  border-top: 2px solid var(--activity-active);
  font-size: 13px;
}

.tab.inactive {
  background: var(--tab-bg);
  color: var(--tab-inactive-fg);
  border-top-color: transparent;
}

.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 18px;
  color: var(--gutter-fg);
  border-bottom: 1px solid color-mix(in srgb, var(--tab-border), transparent 20%);
  font-size: 12px;
}

.editor {
  position: relative;
  overflow: hidden;
  background: var(--editor-bg);
  color: var(--editor-fg);
  font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
  font-size: 18px;
  line-height: 1.52;
}

.active-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 28px;
  background: var(--editor-line);
  will-change: transform;
}

.code {
  position: relative;
  padding: 20px 36px 18px 0;
}

.line {
  height: 28px;
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
}

.line-number {
  padding-right: 18px;
  color: var(--gutter-fg);
  text-align: right;
  user-select: none;
}

.line.is-active .line-number {
  color: var(--gutter-active-fg);
}

.line-code {
  white-space: pre;
}

.char {
  opacity: 0;
}

.tok-comment { color: var(--token-comment); }
.tok-keyword { color: var(--token-keyword); }
.tok-function { color: var(--token-function); }
.tok-string { color: var(--token-string); }
.tok-number { color: var(--token-number); }
.tok-variable { color: var(--token-variable); }
.tok-parameter { color: var(--token-parameter); }
.tok-operator { color: var(--token-operator); }
.tok-punctuation { color: var(--token-punctuation); }
.tok-class-name { color: var(--token-class-name); }

.caret {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 3;
  display: block;
  width: 2px;
  height: 22px;
  background: var(--editor-fg);
  pointer-events: none;
  will-change: transform, opacity;
}

.terminal {
  display: grid;
  grid-template-rows: 32px 1fr;
  background: var(--panel-bg);
  border-top: 1px solid var(--panel-border);
  color: var(--editor-fg);
  font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
  font-size: 14px;
}

.panel-tabs {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 0 18px;
  border-bottom: 1px solid var(--panel-border);
  color: var(--gutter-fg);
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  text-transform: uppercase;
}

.panel-tabs .active {
  color: var(--editor-fg);
  border-bottom: 1px solid var(--activity-active);
  height: 32px;
  display: flex;
  align-items: center;
}

.terminal-body {
  padding: 12px 20px;
  color: var(--editor-fg);
  line-height: 1.8;
}

.prompt {
  color: var(--token-function);
}

.statusbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--status-bg);
  color: var(--status-fg);
  border-top: 1px solid var(--status-border);
  font-size: 12px;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 12px;
}

.remote {
  align-self: stretch;
  display: flex;
  align-items: center;
  padding: 0 12px;
  margin-left: -12px;
  background: var(--status-remote-bg, var(--activity-active));
  color: var(--status-remote-fg, #ffffff);
}

svg {
  display: block;
}
`;

const runtime = String.raw`(() => {
  const codeLines = [
    [{ text: "# A small functional toolkit", token: "comment" }],
    [{ text: "def", token: "keyword" }, { text: " ", token: "plain" }, { text: "pluck_deep", token: "function" }, { text: "(", token: "punctuation" }, { text: "key", token: "parameter" }, { text: "):", token: "punctuation" }],
    [{ text: "    ", token: "plain" }, { text: "return", token: "keyword" }, { text: " ", token: "plain" }, { text: "lambda", token: "keyword" }, { text: " ", token: "plain" }, { text: "obj", token: "parameter" }, { text: ": ", token: "punctuation" }, { text: "reduce", token: "function" }, { text: "(", token: "punctuation" }, { text: "lambda", token: "keyword" }, { text: " ", token: "plain" }, { text: "acc", token: "parameter" }, { text: ", ", token: "punctuation" }, { text: "k", token: "parameter" }, { text: ": ", token: "punctuation" }, { text: "acc", token: "variable" }, { text: "[", token: "punctuation" }, { text: "k", token: "variable" }, { text: "]", token: "punctuation" }, { text: ", ", token: "punctuation" }, { text: "key", token: "variable" }, { text: ".split", token: "function" }, { text: "(", token: "punctuation" }, { text: "'.'", token: "string" }, { text: "), ", token: "punctuation" }, { text: "obj", token: "variable" }, { text: ")", token: "punctuation" }],
    [],
    [{ text: "def", token: "keyword" }, { text: " ", token: "plain" }, { text: "compose", token: "function" }, { text: "(", token: "punctuation" }, { text: "*", token: "operator" }, { text: "fns", token: "parameter" }, { text: "):", token: "punctuation" }],
    [{ text: "    ", token: "plain" }, { text: "return", token: "keyword" }, { text: " ", token: "plain" }, { text: "lambda", token: "keyword" }, { text: " ", token: "plain" }, { text: "res", token: "parameter" }, { text: ": ", token: "punctuation" }, { text: "reduce", token: "function" }, { text: "(", token: "punctuation" }, { text: "lambda", token: "keyword" }, { text: " ", token: "plain" }, { text: "acc", token: "parameter" }, { text: ", ", token: "punctuation" }, { text: "fn", token: "parameter" }, { text: ": ", token: "punctuation" }, { text: "fn", token: "function" }, { text: "(", token: "punctuation" }, { text: "acc", token: "variable" }, { text: "), ", token: "punctuation" }, { text: "fns", token: "variable" }, { text: ", ", token: "punctuation" }, { text: "res", token: "variable" }, { text: ")", token: "punctuation" }],
    [],
    [{ text: "def", token: "keyword" }, { text: " ", token: "plain" }, { text: "unfold", token: "function" }, { text: "(", token: "punctuation" }, { text: "f", token: "parameter" }, { text: ", ", token: "punctuation" }, { text: "seed", token: "parameter" }, { text: "):", token: "punctuation" }],
    [{ text: "    ", token: "plain" }, { text: "\"\"\"Build a list by repeatedly applying f to a seed.\"\"\"", token: "string" }],
    [{ text: "    acc", token: "variable" }, { text: " = ", token: "operator" }, { text: "[]", token: "punctuation" }],
    [{ text: "    while", token: "keyword" }, { text: " ", token: "plain" }, { text: "True", token: "className" }, { text: ":", token: "punctuation" }],
    [{ text: "        result", token: "variable" }, { text: " = ", token: "operator" }, { text: "f", token: "function" }, { text: "(", token: "punctuation" }, { text: "seed", token: "variable" }, { text: ")", token: "punctuation" }],
    [{ text: "        if", token: "keyword" }, { text: " ", token: "plain" }, { text: "result", token: "variable" }, { text: " is ", token: "keyword" }, { text: "None", token: "className" }, { text: ":", token: "punctuation" }],
    [{ text: "            return", token: "keyword" }, { text: " ", token: "plain" }, { text: "acc", token: "variable" }],
    [{ text: "        acc", token: "variable" }, { text: ".append", token: "function" }, { text: "(", token: "punctuation" }, { text: "result", token: "variable" }, { text: "[", token: "punctuation" }, { text: "0", token: "number" }, { text: "])", token: "punctuation" }],
    [{ text: "        seed", token: "variable" }, { text: " = ", token: "operator" }, { text: "result", token: "variable" }, { text: "[", token: "punctuation" }, { text: "1", token: "number" }, { text: "]", token: "punctuation" }],
    [],
  ];

  const fallback = {
    "activityBar.background": "#181818",
    "activityBar.foreground": "#d7d7d7",
    "activityBar.inactiveForeground": "#868686",
    "activityBar.activeBorder": "#0078d4",
    "sideBar.background": "#181818",
    "sideBar.foreground": "#cccccc",
    "sideBar.border": "#2b2b2b",
    "tab.activeBackground": "#1f1f1f",
    "tab.activeForeground": "#ffffff",
    "tab.inactiveBackground": "#181818",
    "tab.inactiveForeground": "#9d9d9d",
    "tab.border": "#2b2b2b",
    "editor.background": "#1f1f1f",
    "editor.foreground": "#cccccc",
    "editor.lineHighlightBackground": "#ffffff0a",
    "editorLineNumber.foreground": "#6e7681",
    "editorLineNumber.activeForeground": "#cccccc",
    "panel.background": "#181818",
    "panel.border": "#2b2b2b",
    "statusBar.background": "#181818",
    "statusBar.foreground": "#cccccc",
    "statusBar.border": "#2b2b2b",
    "titleBar.activeBackground": "#181818",
    "titleBar.activeForeground": "#cccccc",
  };

  function color(theme, key) {
    return theme.colors[key] || fallback[key] || theme.colors.foreground || "#cccccc";
  }

  function solarizedGrey(theme) {
    return theme.colors["tab.inactiveForeground"] || theme.colors["editor.foreground"] || "#586E75";
  }

  function setVar(root, name, value) {
    root.style.setProperty(name, value);
  }

  function applyTheme(root, theme) {
    const solarizedUiGrey = theme.id === "solarized-light" ? solarizedGrey(theme) : null;
    setVar(root, "--activity-bg", color(theme, "activityBar.background"));
    setVar(root, "--activity-fg", solarizedUiGrey || color(theme, "activityBar.foreground"));
    setVar(root, "--activity-muted", solarizedUiGrey || color(theme, "activityBar.inactiveForeground"));
    setVar(root, "--activity-active", color(theme, "activityBar.activeBorder"));
    setVar(root, "--sidebar-bg", color(theme, "sideBar.background"));
    setVar(root, "--sidebar-fg", solarizedUiGrey || color(theme, "sideBar.foreground"));
    setVar(root, "--sidebar-border", color(theme, "sideBar.border"));
    setVar(root, "--tab-bg", color(theme, "tab.inactiveBackground"));
    setVar(root, "--tab-active-bg", color(theme, "tab.activeBackground"));
    setVar(root, "--tab-active-fg", solarizedUiGrey || color(theme, "tab.activeForeground"));
    setVar(root, "--tab-inactive-fg", solarizedUiGrey || color(theme, "tab.inactiveForeground"));
    setVar(root, "--tab-border", color(theme, "tab.border"));
    setVar(root, "--editor-bg", color(theme, "editor.background"));
    setVar(root, "--editor-fg", color(theme, "editor.foreground"));
    setVar(root, "--editor-line", color(theme, "editor.lineHighlightBackground"));
    setVar(root, "--gutter-fg", color(theme, "editorLineNumber.foreground"));
    setVar(root, "--gutter-active-fg", color(theme, "editorLineNumber.activeForeground"));
    setVar(root, "--panel-bg", color(theme, "panel.background"));
    setVar(root, "--panel-border", color(theme, "panel.border"));
    setVar(root, "--status-bg", color(theme, "statusBar.background"));
    setVar(root, "--status-fg", color(theme, "statusBar.foreground"));
    setVar(root, "--status-border", color(theme, "statusBar.border"));
    setVar(root, "--status-remote-bg", color(theme, "statusBarItem.remoteBackground"));
    setVar(root, "--status-remote-fg", solarizedUiGrey || color(theme, "statusBarItem.remoteForeground"));
    setVar(root, "--title-bg", color(theme, "titleBar.activeBackground"));
    setVar(root, "--title-fg", solarizedUiGrey || color(theme, "titleBar.activeForeground"));
    setVar(root, "--token-comment", theme.tokens.comment);
    setVar(root, "--token-keyword", theme.tokens.keyword);
    setVar(root, "--token-function", theme.tokens.function);
    setVar(root, "--token-string", theme.tokens.string);
    setVar(root, "--token-number", theme.tokens.number);
    setVar(root, "--token-variable", theme.tokens.variable);
    setVar(root, "--token-parameter", theme.tokens.parameter);
    setVar(root, "--token-operator", theme.tokens.operator);
    setVar(root, "--token-punctuation", theme.tokens.punctuation);
    setVar(root, "--token-class-name", theme.tokens.className);
  }

  function renderCode(root) {
    const code = root.querySelector(".code");
    codeLines.forEach((segments, index) => {
      const line = document.createElement("div");
      line.className = "line";
      line.dataset.lineIndex = String(index);

      const lineNumber = document.createElement("span");
      lineNumber.className = "line-number";
      lineNumber.textContent = String(index + 1);
      line.appendChild(lineNumber);

      const lineCode = document.createElement("span");
      lineCode.className = "line-code";
      segments.forEach((segment) => {
        [...segment.text].forEach((char) => {
          const span = document.createElement("span");
          span.className = segment.token === "plain" ? "char" : "char tok-" + segment.token.replace(/[A-Z]/g, (match) => "-" + match.toLowerCase());
          span.dataset.lineIndex = String(index);
          span.textContent = char;
          lineCode.appendChild(span);
        });
      });
      line.appendChild(lineCode);
      code.appendChild(line);
    });

    const caret = document.createElement("span");
    caret.className = "caret";
    root.querySelector(".editor").appendChild(caret);
  }

  function caretPointForElement(editor, el) {
    const editorBox = editor.getBoundingClientRect();
    const charBox = el.getBoundingClientRect();
    return {
      x: charBox.right - editorBox.left + 2,
      y: charBox.top - editorBox.top + 3,
    };
  }

  function caretPointForLineStart(editor, line) {
    const editorBox = editor.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    const codeBox = line.querySelector(".line-code").getBoundingClientRect();
    return {
      x: codeBox.left - editorBox.left,
      y: lineBox.top - editorBox.top + 3,
    };
  }

  function lineHighlightY(editor, line) {
    const editorBox = editor.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    return lineBox.top - editorBox.top;
  }

  function buildTimeline(root, compositionId) {
    const tl = gsap.timeline({ paused: true });
    const editor = root.querySelector(".editor");
    const caret = root.querySelector(".caret");
    const activeLine = root.querySelector(".active-line");
    const lineEls = gsap.utils.toArray(root.querySelectorAll(".line"));
    const lineStartTimes = [];
    const charSchedule = [];
    let cursorTime = 0.95;

    lineEls.forEach((line, lineIndex) => {
      const lineChars = gsap.utils.toArray(line.querySelectorAll(".char"));
      lineStartTimes[lineIndex] = cursorTime;
      lineChars.forEach((char, charIndex) => {
        charSchedule.push({ char, time: cursorTime + charIndex * 0.012 });
      });
      cursorTime += Math.max(lineChars.length * 0.012, 0.08) + 0.045;
    });

    gsap.set(activeLine, { y: lineHighlightY(editor, lineEls[0]) });
    gsap.set(caret, caretPointForLineStart(editor, lineEls[0]));

    tl.from(root.querySelector(".header"), { y: 24, opacity: 0, duration: 0.45, ease: "power3.out" }, 0);
    tl.from(root.querySelector(".workbench"), { y: 42, opacity: 0, scale: 0.986, duration: 0.58, ease: "power3.out" }, 0.1);
    tl.from(activeLine, { opacity: 0, duration: 0.22, ease: "power2.out" }, 0.74);
    lineStartTimes.forEach((time, lineIndex) => {
      const line = lineEls[lineIndex];
      tl.set(activeLine, { y: lineHighlightY(editor, line) }, time);
      tl.set(caret, caretPointForLineStart(editor, line), time);
      tl.call(() => {
        lineEls.forEach((item) => item.classList.toggle("is-active", item === line));
      }, [], time);
    });
    charSchedule.forEach(({ char, time }) => {
      tl.set(char, { opacity: 1 }, time);
      tl.set(caret, caretPointForElement(editor, char), time + 0.002);
    });
    tl.to(root.querySelector(".caret"), { opacity: 0, duration: 0.34, repeat: 25, yoyo: true, ease: "steps(1)" }, 0.95);
    tl.from(root.querySelector(".terminal"), { y: 140, opacity: 0, duration: 0.56, ease: "power3.out" }, 7.55);
    tl.from(root.querySelector(".terminal-body").children, { opacity: 0, y: 8, duration: 0.24, stagger: 0.16, ease: "power2.out" }, 8.05);
    tl.to(root.querySelector(".workbench"), { rotateY: -10.5, z: 74, duration: 0.72, ease: "power2.inOut" }, 9.35);
    tl.to(root.querySelector(".workbench"), { rotateY: 0, z: 0, duration: 0.62, ease: "power2.inOut" }, 10.08);

    window.__timelines = window.__timelines || {};
    window.__timelines[compositionId] = tl;

    const previewTime = new URLSearchParams(window.location.search).get("t");
    if (previewTime !== null) {
      tl.time(Number(previewTime));
    }
  }

  window.createVSCodeThemeComposition = (compositionId, themeOrId) => {
    const root =
      document.querySelector('[data-composition-id="' + compositionId + '"] .vscode-theme-scene') ||
      document.querySelector('.vscode-theme-scene[data-composition-id="' + compositionId + '"]') ||
      document.querySelector('[data-composition-id="' + compositionId + '"]');
    const theme = typeof themeOrId === "string"
      ? window.VSCODE_THEME_REGISTRY.find((item) => item.id === themeOrId)
      : themeOrId;
    if (!root || !theme) return;
    root.querySelector(".theme-label").textContent = theme.label;
    root.querySelector(".theme-source").textContent = theme.sourceFile;
    applyTheme(root, theme);
    renderCode(root);
    buildTimeline(root, compositionId);
  };
})();
`;

function compositionMarkup(compositionId, theme) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${theme.label} VS Code Theme Composition</title>
  </head>
  <body>
    <template id="${compositionId}-template">
      <div class="vscode-theme-scene" data-composition-id="${compositionId}" data-width="1920" data-height="1080">
        <main class="scene-content">
          <section class="header">
            <div>
              <p class="kicker">Official VS Code built-in theme</p>
              <h1 class="title"><span class="theme-label">${theme.label}</span></h1>
            </div>
            <p class="source-note">
              Typing \`functional_toolkit.py\` with workbench colors from
              <span class="theme-source">${theme.sourceFile}</span>.
            </p>
          </section>

          ${workbenchMarkup()}
        </main>
        <style>
${css}
        </style>
        <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
        <script>
${runtime}
        </script>
        <script>
          window.__timelines = window.__timelines || {};
          window.__timelines["${compositionId}"] = window.__timelines["${compositionId}"] || gsap.timeline({ paused: true });
          window.createVSCodeThemeComposition("${compositionId}", ${JSON.stringify(theme)});
        </script>
      </div>
    </template>
  </body>
</html>
`;
}

function workbenchMarkup() {
  return `<section class="workbench">
  <div class="titlebar">
    <div class="traffic"><span></span><span></span><span></span></div>
    <div class="window-title">functional-toolkit - Visual Studio Code</div>
    <div class="command-center">Search</div>
  </div>

  <aside class="activity" aria-label="Activity bar">
    <svg class="activity-icon active" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" /></svg>
    <svg class="activity-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="m21 21-5.2-5.2M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" /></svg>
    <svg class="activity-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M8 18 3 12l5-6m8 12 5-6-5-6" /></svg>
    <svg class="activity-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 3v18m0-18 6 6m-6-6L6 9m6 12 6-6m-6 6-6-6" /></svg>
  </aside>

  <aside class="sidebar">
    <div class="sidebar-title">Explorer</div>
    <div class="section-title">⌄ Functional Toolkit</div>
    <div class="tree">
      <div class="tree-row">⌄ src</div>
      <div class="tree-row child selected">◇ functional_toolkit.py</div>
      <div class="tree-row child">◇ test_toolkit.py</div>
      <div class="tree-row">◇ pyproject.toml</div>
      <div class="tree-row">◇ README.md</div>
    </div>
  </aside>

  <section class="editor-area">
    <div class="tabs">
      <div class="tab">◇ functional_toolkit.py</div>
      <div class="tab inactive">README.md</div>
    </div>
    <div class="breadcrumbs">functional-toolkit › src › functional_toolkit.py</div>
    <div class="editor">
      <div class="active-line"></div>
      <div class="code"></div>
    </div>
    <div class="terminal">
      <div class="panel-tabs"><span class="active">Terminal</span><span>Problems</span><span>Output</span></div>
      <div class="terminal-body">
        <div><span class="prompt">functional-toolkit %</span> python -m pytest</div>
        <div>collected 3 items</div>
        <div>tests/test_toolkit.py ... <span class="tok-comment">passed</span></div>
      </div>
    </div>
  </section>

  <footer class="statusbar">
    <div class="status-left">
      <span class="remote">main</span>
      <span>0 errors</span>
      <span>0 warnings</span>
    </div>
    <div class="status-right">
      <span>Ln 17, Col 1</span>
      <span>Spaces: 4</span>
      <span>UTF-8</span>
      <span>Python 3.12</span>
    </div>
  </footer>
</section>`;
}

function rootIndexMarkup() {
  const clips = registry
    .map((theme, index) => {
      const compositionId = `vscode-${theme.id}`;
      return `      <div
        id="clip-${theme.id}"
        data-composition-id="${compositionId}"
        data-composition-src="compositions/${theme.id}.html"
        data-start="${index * clipDuration}"
        data-duration="${clipDuration}"
        data-track-index="1"
      ></div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>VS Code Theme Sequence</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html,
      body {
        margin: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #000000;
      }

      #vscode-theme-sequence {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #000000;
      }
    </style>
  </head>
  <body>
    <div id="vscode-theme-sequence" data-composition-id="vscode-theme-sequence" data-start="0" data-width="1920" data-height="1080">
${clips}
      <script>
        window.__timelines = window.__timelines || {};
        window.__timelines["vscode-theme-sequence"] = gsap.timeline({ paused: true });
      </script>
    </div>
  </body>
</html>
`;
}

function renderEntryMarkup(theme) {
  const compositionId = `vscode-${theme.id}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${theme.label} Render Entry</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html,
      body {
        margin: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #000000;
      }

      #render-${theme.id} {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #000000;
      }
    </style>
  </head>
  <body>
    <div id="render-${theme.id}" data-composition-id="render-${theme.id}" data-start="0" data-duration="${clipDuration}" data-width="1920" data-height="1080">
      <div
        id="clip-${theme.id}"
        data-composition-id="${compositionId}"
        data-composition-src="../compositions/${theme.id}.html"
        data-start="0"
        data-duration="${clipDuration}"
        data-track-index="1"
      ></div>
      <script>
        window.__timelines = window.__timelines || {};
        window.__timelines["render-${theme.id}"] = gsap.timeline({ paused: true });
      </script>
    </div>
  </body>
</html>
`;
}

fs.writeFileSync(path.join(assetsDir, "vscode-sequence.css"), css);
fs.writeFileSync(path.join(assetsDir, "vscode-sequence-runtime.js"), runtime);

for (const theme of registry) {
  const compositionId = `vscode-${theme.id}`;
  fs.writeFileSync(
    path.join(compositionsDir, `${theme.id}.html`),
    compositionMarkup(compositionId, theme),
  );
  fs.writeFileSync(path.join(renderEntriesDir, `${theme.id}.html`), renderEntryMarkup(theme));

  const blockName = `code-snippet-${theme.id}`;
  const blockDir = path.join(blocksDir, blockName);
  fs.mkdirSync(blockDir, { recursive: true });
  fs.writeFileSync(
    path.join(blockDir, `${blockName}.html`),
    compositionMarkup(compositionId, theme),
  );
}

fs.writeFileSync(path.join(projectRoot, "index.html"), rootIndexMarkup());

console.log(
  `Wrote ${registry.length} themed compositions, render entries, block HTMLs, and root sequence`,
);
