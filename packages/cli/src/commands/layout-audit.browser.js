(function () {
  const IGNORE_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "META", "LINK"]);

  function toRect(rect) {
    return {
      left: round(rect.left),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      width: round(rect.width),
      height: round(rect.height),
    };
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function overflowFor(subject, container, tolerance) {
    const overflow = {};
    if (subject.left < container.left - tolerance)
      overflow.left = round(container.left - subject.left);
    if (subject.right > container.right + tolerance)
      overflow.right = round(subject.right - container.right);
    if (subject.top < container.top - tolerance) overflow.top = round(container.top - subject.top);
    if (subject.bottom > container.bottom + tolerance)
      overflow.bottom = round(subject.bottom - container.bottom);
    return Object.keys(overflow).length > 0 ? overflow : null;
  }

  function escapeCss(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function selectorFor(element) {
    if (element.id) return `#${escapeCss(element.id)}`;
    const dataName =
      element.getAttribute("data-layout-name") ||
      element.getAttribute("data-composition-id") ||
      element.getAttribute("data-start");
    if (dataName) {
      const attr = element.hasAttribute("data-layout-name")
        ? "data-layout-name"
        : element.hasAttribute("data-composition-id")
          ? "data-composition-id"
          : "data-start";
      return `${element.tagName.toLowerCase()}[${attr}="${escapeCss(dataName)}"]`;
    }
    const classes = Array.from(element.classList).slice(0, 2);
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes.map(escapeCss).join(".")}`;
    }
    const parent = element.parentElement;
    if (!parent) return element.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === element.tagName,
    );
    const index = siblings.indexOf(element) + 1;
    return `${selectorFor(parent)} > ${element.tagName.toLowerCase()}:nth-of-type(${index})`;
  }

  function hasIgnoreFlag(element) {
    return !!element.closest("[data-layout-ignore], [data-layout-check='ignore']");
  }

  function hasAllowOverflowFlag(element) {
    return !!element.closest("[data-layout-allow-overflow]");
  }

  function opacityChain(element) {
    let opacity = 1;
    for (let current = element; current; current = current.parentElement) {
      const parsed = Number.parseFloat(getComputedStyle(current).opacity || "1");
      if (Number.isFinite(parsed)) opacity *= parsed;
    }
    return opacity;
  }

  function isVisibleElement(element) {
    if (IGNORE_TAGS.has(element.tagName)) return false;
    if (hasIgnoreFlag(element)) return false;
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }
    if (opacityChain(element) < 0.2) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  }

  function textContentFor(element) {
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function hasOwnTextCandidate(element) {
    const text = textContentFor(element);
    if (!text) return false;
    for (const child of Array.from(element.children)) {
      if (isVisibleElement(child) && textContentFor(child)) return false;
    }
    return true;
  }

  function textRectFor(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0.5 && rect.height > 0.5,
    );
    range.detach();
    if (rects.length === 0) return null;

    const union = rects.reduce(
      (acc, rect) => ({
        left: Math.min(acc.left, rect.left),
        top: Math.min(acc.top, rect.top),
        right: Math.max(acc.right, rect.right),
        bottom: Math.max(acc.bottom, rect.bottom),
      }),
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      },
    );

    return toRect({
      ...union,
      width: union.right - union.left,
      height: union.bottom - union.top,
    });
  }

  function parsePx(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function hasPaint(style) {
    const backgroundColor = style.backgroundColor || "";
    const hasBackground =
      backgroundColor !== "" &&
      backgroundColor !== "transparent" &&
      !backgroundColor.endsWith(", 0)") &&
      backgroundColor !== "rgba(0, 0, 0, 0)";
    const hasImage = style.backgroundImage && style.backgroundImage !== "none";
    const hasBorder =
      parsePx(style.borderTopWidth) +
        parsePx(style.borderRightWidth) +
        parsePx(style.borderBottomWidth) +
        parsePx(style.borderLeftWidth) >
      0;
    const hasRadius =
      parsePx(style.borderTopLeftRadius) +
        parsePx(style.borderTopRightRadius) +
        parsePx(style.borderBottomRightRadius) +
        parsePx(style.borderBottomLeftRadius) >
      0;
    return hasBackground || hasImage || hasBorder || hasRadius;
  }

  function clipsOverflow(style) {
    return [style.overflowX, style.overflowY, style.overflow].some(
      (value) => value && value !== "visible" && value !== "clip visible",
    );
  }

  function isConstraintCandidate(element, root) {
    if (element === root) return true;
    const style = getComputedStyle(element);
    if (clipsOverflow(style)) return true;
    if (element.hasAttribute("data-layout-boundary")) return true;
    if (!hasPaint(style)) return false;
    const rect = element.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const rootArea = rootRect.width * rootRect.height;
    const area = rect.width * rect.height;
    return area > 0 && area < rootArea * 0.95;
  }

  function nearestConstraint(element, root) {
    for (
      let current = element;
      current && current !== document.body;
      current = current.parentElement
    ) {
      if (!isVisibleElement(current)) continue;
      if (isConstraintCandidate(current, root)) return current;
      if (current === root) return current;
    }
    return root;
  }

  function clippedTextIssue(element, time, tolerance) {
    const style = getComputedStyle(element);
    if (!clipsOverflow(style)) return null;
    const overflowX = element.scrollWidth - element.clientWidth;
    const overflowY = element.scrollHeight - element.clientHeight;
    if (overflowX <= tolerance && overflowY <= tolerance) return null;
    const overflow = {};
    if (overflowX > tolerance) overflow.right = round(overflowX);
    if (overflowY > tolerance) overflow.bottom = round(overflowY);
    const selector = selectorFor(element);
    const text = textContentFor(element);
    return {
      code: "clipped_text",
      severity: "error",
      time,
      selector,
      text,
      message: "Text content is clipped by its own box.",
      rect: toRect(element.getBoundingClientRect()),
      overflow,
      fixHint:
        "Increase the element width/height, reduce font-size, loosen letter-spacing, or use fitTextFontSize for dynamic copy.",
    };
  }

  function textOverflowIssues(element, root, rootRect, time, tolerance) {
    const textRect = textRectFor(element);
    if (!textRect) return [];
    const text = textContentFor(element);
    const selector = selectorFor(element);
    const issues = [];

    const container = nearestConstraint(element, root);
    const containerRect = toRect(container.getBoundingClientRect());
    const containerOverflow = overflowFor(textRect, containerRect, tolerance);
    if (containerOverflow && !hasAllowOverflowFlag(element)) {
      issues.push({
        code: "text_box_overflow",
        severity: "error",
        time,
        selector,
        containerSelector: selectorFor(container),
        text,
        message: "Text extends outside its nearest visual/container box.",
        rect: textRect,
        containerRect,
        overflow: containerOverflow,
        fixHint:
          "Increase the bubble/container size or padding, reduce font-size/letter-spacing, or set a max-width that allows wrapping inside the container.",
      });
    }

    const canvasOverflow = overflowFor(textRect, rootRect, tolerance);
    if (canvasOverflow && !hasAllowOverflowFlag(element)) {
      issues.push({
        code: "canvas_overflow",
        severity: "warning",
        time,
        selector,
        containerSelector: selectorFor(root),
        text,
        message: "Text extends outside the composition canvas.",
        rect: textRect,
        containerRect: rootRect,
        overflow: canvasOverflow,
        fixHint:
          "Move the text inward, reduce its size, or mark intentional off-canvas animation with data-layout-allow-overflow.",
      });
    }

    return issues;
  }

  function containerOverflowIssues(root, time, tolerance) {
    const issues = [];
    const containers = Array.from(root.querySelectorAll("*")).filter((element) => {
      if (!isVisibleElement(element) || hasAllowOverflowFlag(element)) return false;
      const style = getComputedStyle(element);
      return clipsOverflow(style) || element.hasAttribute("data-layout-boundary");
    });

    for (const container of containers) {
      const containerRect = toRect(container.getBoundingClientRect());
      for (const child of Array.from(container.children)) {
        if (!isVisibleElement(child) || hasAllowOverflowFlag(child)) continue;
        const childRect = toRect(child.getBoundingClientRect());
        const overflow = overflowFor(childRect, containerRect, tolerance);
        if (!overflow) continue;
        issues.push({
          code: "container_overflow",
          severity: "warning",
          time,
          selector: selectorFor(child),
          containerSelector: selectorFor(container),
          message: "Element extends outside a clipping layout container.",
          rect: childRect,
          containerRect,
          overflow,
          fixHint:
            "Resize/reposition the child or container, or mark intentional overflow with data-layout-allow-overflow.",
        });
      }
    }

    return issues;
  }

  window.__hyperframesLayoutAudit = function auditLayout(options) {
    const time = options && typeof options.time === "number" ? options.time : 0;
    const tolerance =
      options && typeof options.tolerance === "number" ? Math.max(0, options.tolerance) : 2;
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const rootRect = toRect(root.getBoundingClientRect());
    const elements = Array.from(root.querySelectorAll("*")).filter(isVisibleElement);
    const issues = [];

    for (const element of elements) {
      if (!hasOwnTextCandidate(element)) continue;
      const clipped = clippedTextIssue(element, time, tolerance);
      if (clipped) issues.push(clipped);
      issues.push(...textOverflowIssues(element, root, rootRect, time, tolerance));
    }

    issues.push(...containerOverflowIssues(root, time, tolerance));
    return issues;
  };
})();
