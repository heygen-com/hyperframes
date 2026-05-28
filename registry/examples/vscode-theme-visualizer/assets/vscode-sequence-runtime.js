(() => {
  const codeLines = [
    [{ text: "# A small functional toolkit", token: "comment" }],
    [
      { text: "def", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "pluck_deep", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "key", token: "parameter" },
      { text: "):", token: "punctuation" },
    ],
    [
      { text: "    ", token: "plain" },
      { text: "return", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "lambda", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "obj", token: "parameter" },
      { text: ": ", token: "punctuation" },
      { text: "reduce", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "lambda", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "acc", token: "parameter" },
      { text: ", ", token: "punctuation" },
      { text: "k", token: "parameter" },
      { text: ": ", token: "punctuation" },
      { text: "acc", token: "variable" },
      { text: "[", token: "punctuation" },
      { text: "k", token: "variable" },
      { text: "]", token: "punctuation" },
      { text: ", ", token: "punctuation" },
      { text: "key", token: "variable" },
      { text: ".split", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "'.'", token: "string" },
      { text: "), ", token: "punctuation" },
      { text: "obj", token: "variable" },
      { text: ")", token: "punctuation" },
    ],
    [],
    [
      { text: "def", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "compose", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "*", token: "operator" },
      { text: "fns", token: "parameter" },
      { text: "):", token: "punctuation" },
    ],
    [
      { text: "    ", token: "plain" },
      { text: "return", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "lambda", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "res", token: "parameter" },
      { text: ": ", token: "punctuation" },
      { text: "reduce", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "lambda", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "acc", token: "parameter" },
      { text: ", ", token: "punctuation" },
      { text: "fn", token: "parameter" },
      { text: ": ", token: "punctuation" },
      { text: "fn", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "acc", token: "variable" },
      { text: "), ", token: "punctuation" },
      { text: "fns", token: "variable" },
      { text: ", ", token: "punctuation" },
      { text: "res", token: "variable" },
      { text: ")", token: "punctuation" },
    ],
    [],
    [
      { text: "def", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "unfold", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "f", token: "parameter" },
      { text: ", ", token: "punctuation" },
      { text: "seed", token: "parameter" },
      { text: "):", token: "punctuation" },
    ],
    [
      { text: "    ", token: "plain" },
      { text: '"""Build a list by repeatedly applying f to a seed."""', token: "string" },
    ],
    [
      { text: "    acc", token: "variable" },
      { text: " = ", token: "operator" },
      { text: "[]", token: "punctuation" },
    ],
    [
      { text: "    while", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "True", token: "className" },
      { text: ":", token: "punctuation" },
    ],
    [
      { text: "        result", token: "variable" },
      { text: " = ", token: "operator" },
      { text: "f", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "seed", token: "variable" },
      { text: ")", token: "punctuation" },
    ],
    [
      { text: "        if", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "result", token: "variable" },
      { text: " is ", token: "keyword" },
      { text: "None", token: "className" },
      { text: ":", token: "punctuation" },
    ],
    [
      { text: "            return", token: "keyword" },
      { text: " ", token: "plain" },
      { text: "acc", token: "variable" },
    ],
    [
      { text: "        acc", token: "variable" },
      { text: ".append", token: "function" },
      { text: "(", token: "punctuation" },
      { text: "result", token: "variable" },
      { text: "[", token: "punctuation" },
      { text: "0", token: "number" },
      { text: "])", token: "punctuation" },
    ],
    [
      { text: "        seed", token: "variable" },
      { text: " = ", token: "operator" },
      { text: "result", token: "variable" },
      { text: "[", token: "punctuation" },
      { text: "1", token: "number" },
      { text: "]", token: "punctuation" },
    ],
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
    setVar(
      root,
      "--activity-muted",
      solarizedUiGrey || color(theme, "activityBar.inactiveForeground"),
    );
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
    setVar(
      root,
      "--status-remote-fg",
      solarizedUiGrey || color(theme, "statusBarItem.remoteForeground"),
    );
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
          span.className =
            segment.token === "plain"
              ? "char"
              : "char tok-" + segment.token.replace(/[A-Z]/g, (match) => "-" + match.toLowerCase());
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

    tl.from(
      root.querySelector(".header"),
      { y: 24, opacity: 0, duration: 0.45, ease: "power3.out" },
      0,
    );
    tl.from(
      root.querySelector(".workbench"),
      { y: 42, opacity: 0, scale: 0.986, duration: 0.58, ease: "power3.out" },
      0.1,
    );
    tl.from(activeLine, { opacity: 0, duration: 0.22, ease: "power2.out" }, 0.74);
    lineStartTimes.forEach((time, lineIndex) => {
      const line = lineEls[lineIndex];
      tl.set(activeLine, { y: lineHighlightY(editor, line) }, time);
      tl.set(caret, caretPointForLineStart(editor, line), time);
      tl.call(
        () => {
          lineEls.forEach((item) => item.classList.toggle("is-active", item === line));
        },
        [],
        time,
      );
    });
    charSchedule.forEach(({ char, time }) => {
      tl.set(char, { opacity: 1 }, time);
      tl.set(caret, caretPointForElement(editor, char), time + 0.002);
    });
    tl.to(
      root.querySelector(".caret"),
      { opacity: 0, duration: 0.34, repeat: 25, yoyo: true, ease: "steps(1)" },
      0.95,
    );
    tl.from(
      root.querySelector(".terminal"),
      { y: 140, opacity: 0, duration: 0.56, ease: "power3.out" },
      7.55,
    );
    tl.from(
      root.querySelector(".terminal-body").children,
      { opacity: 0, y: 8, duration: 0.24, stagger: 0.16, ease: "power2.out" },
      8.05,
    );
    tl.to(
      root.querySelector(".workbench"),
      { rotateY: -10.5, z: 74, duration: 0.72, ease: "power2.inOut" },
      9.35,
    );
    tl.to(
      root.querySelector(".workbench"),
      { rotateY: 0, z: 0, duration: 0.62, ease: "power2.inOut" },
      10.08,
    );

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
    const theme =
      typeof themeOrId === "string"
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
