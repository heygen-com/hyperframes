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

  function rectFromOrigin(left, top, width, height) {
    return {
      left: round(left),
      top: round(top),
      right: round(left + width),
      bottom: round(top + height),
      width: round(width),
      height: round(height),
    };
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function overflowFor(subject, container, tolerance, vTolerance) {
    // Horizontal axis uses `tolerance`; vertical axis uses `vTolerance` (defaults to the same).
    // A separate vertical tolerance lets text overflow checks absorb glyph ink that exceeds a
    // snug line-height — see textOverflowIssues.
    if (vTolerance == null) vTolerance = tolerance;
    const overflow = {};
    if (subject.left < container.left - tolerance)
      overflow.left = round(container.left - subject.left);
    if (subject.right > container.right + tolerance)
      overflow.right = round(subject.right - container.right);
    if (subject.top < container.top - vTolerance) overflow.top = round(container.top - subject.top);
    if (subject.bottom > container.bottom + vTolerance)
      overflow.bottom = round(subject.bottom - container.bottom);
    return Object.keys(overflow).length > 0 ? overflow : null;
  }

  function escapeCss(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function escapeAttr(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
      const attrSelector = `[${attr}="${escapeAttr(dataName)}"]`;
      if (document.querySelectorAll(attrSelector).length === 1) return attrSelector;
      return `${element.tagName.toLowerCase()}${attrSelector}`;
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

  function hasMeaningfulBoxStyle(style) {
    return (
      parsePx(style.paddingTop) +
        parsePx(style.paddingRight) +
        parsePx(style.paddingBottom) +
        parsePx(style.paddingLeft) +
        parsePx(style.borderTopWidth) +
        parsePx(style.borderRightWidth) +
        parsePx(style.borderBottomWidth) +
        parsePx(style.borderLeftWidth) +
        parsePx(style.borderTopLeftRadius) +
        parsePx(style.borderTopRightRadius) +
        parsePx(style.borderBottomRightRadius) +
        parsePx(style.borderBottomLeftRadius) >
      0
    );
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

  function rootRectFor(root) {
    const measured = toRect(root.getBoundingClientRect());
    const authoredWidth = Number.parseFloat(root.getAttribute("data-width") || "");
    const authoredHeight = Number.parseFloat(root.getAttribute("data-height") || "");
    const hasAuthoredSize =
      Number.isFinite(authoredWidth) &&
      authoredWidth > 0 &&
      Number.isFinite(authoredHeight) &&
      authoredHeight > 0;

    if (!hasAuthoredSize) return measured;
    if (measured.width > 0.5 && measured.height > 0.5) return measured;
    return rectFromOrigin(measured.left, measured.top, authoredWidth, authoredHeight);
  }

  function isConstraintCandidate(element, root, rootRect) {
    if (element === root) return true;
    const style = getComputedStyle(element);
    if (clipsOverflow(style)) return true;
    if (element.hasAttribute("data-layout-boundary")) return true;
    if (!hasPaint(style)) return false;
    if (!hasMeaningfulBoxStyle(style)) return false;
    const rect = element.getBoundingClientRect();
    const rootArea = rootRect.width * rootRect.height;
    const area = rect.width * rect.height;
    return area > 0 && area < rootArea * 0.95;
  }

  function nearestConstraint(element, root, rootRect) {
    for (
      let current = element;
      current && current !== document.body;
      current = current.parentElement
    ) {
      if (!isVisibleElement(current)) continue;
      if (isConstraintCandidate(current, root, rootRect)) return current;
      if (current === root) return current;
    }
    return root;
  }

  function formatPx(value) {
    return `${Math.round(value)}px`;
  }

  function maxOverflow(overflow) {
    return Math.max(...Object.values(overflow).filter((value) => typeof value === "number"));
  }

  function textOverflowFixHint(textRect, containerRect, overflow, fontSize, targetName) {
    const horizontalOverflow = (overflow.left || 0) + (overflow.right || 0);
    const verticalOverflow = (overflow.top || 0) + (overflow.bottom || 0);
    const neededWidth = containerRect.width + horizontalOverflow;
    const neededHeight = containerRect.height + verticalOverflow;
    const widthRatio = containerRect.width > 0 ? containerRect.width / textRect.width : 0;
    const heightRatio = containerRect.height > 0 ? containerRect.height / textRect.height : 0;
    const limitingRatio = Math.min(
      widthRatio > 0 ? widthRatio : Number.POSITIVE_INFINITY,
      heightRatio > 0 ? heightRatio : Number.POSITIVE_INFINITY,
    );
    const shrinkPercent =
      Number.isFinite(limitingRatio) && limitingRatio < 1
        ? Math.ceil((1 - limitingRatio) * 100)
        : 0;
    const targetFont =
      shrinkPercent > 0 && Number.isFinite(fontSize) && fontSize > 0
        ? ` or shrink font-size from ${formatPx(fontSize)} to ~${formatPx(fontSize * limitingRatio)}`
        : "";
    const sizeTarget =
      horizontalOverflow > 0 && verticalOverflow > 0
        ? `resize ${targetName} to at least ~${formatPx(neededWidth)} x ${formatPx(neededHeight)}`
        : horizontalOverflow > 0
          ? `widen ${targetName} to at least ~${formatPx(neededWidth)}`
          : `increase ${targetName} height to at least ~${formatPx(neededHeight)}`;

    return `Text is ${formatPx(textRect.width)} x ${formatPx(textRect.height)} inside ${formatPx(containerRect.width)} x ${formatPx(containerRect.height)} and overflows by up to ${formatPx(maxOverflow(overflow))}; ${sizeTarget}${targetFont}, or allow wrapping with max-width/fitTextFontSize.`;
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
    const rect = toRect(element.getBoundingClientRect());
    const fontSize = parsePx(style.fontSize);
    return {
      code: "clipped_text",
      severity: "error",
      time,
      selector,
      text,
      message: "Text content is clipped by its own box.",
      rect,
      overflow,
      fixHint: textOverflowFixHint(rect, rect, overflow, fontSize, "the text box"),
    };
  }

  function textOverflowIssues(element, root, rootRect, time, tolerance) {
    const textRect = textRectFor(element);
    if (!textRect) return [];
    const text = textContentFor(element);
    const selector = selectorFor(element);
    const issues = [];

    const container = nearestConstraint(element, root, rootRect);
    const containerRect = container === root ? rootRect : toRect(container.getBoundingClientRect());
    // Glyph ink (ascenders / descenders / accents / heavy display faces) routinely exceeds a
    // snug line-height box by a few px, proportional to font size. When the constraining box
    // does NOT clip, that vertical spill is normal typography — it shows in the padding, nothing
    // is hidden — not a layout defect (it false-flagged caption words). Allow a font-metric
    // vertical tolerance there; keep it tight when the box actually clips (a real cut-off) and
    // always tight horizontally (too-wide text is a real wrap/legibility issue).
    const elementStyle = getComputedStyle(element);
    const containerClips = clipsOverflow(
      container === root ? getComputedStyle(root) : getComputedStyle(container),
    );
    const verticalTolerance = containerClips
      ? tolerance
      : Math.max(tolerance, parsePx(elementStyle.fontSize) * 0.2);
    const containerOverflow = overflowFor(textRect, containerRect, tolerance, verticalTolerance);
    if (containerOverflow && !hasAllowOverflowFlag(element)) {
      const style = elementStyle;
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
        fixHint: textOverflowFixHint(
          textRect,
          containerRect,
          containerOverflow,
          parsePx(style.fontSize),
          "the container",
        ),
      });
    }

    const canvasOverflow = overflowFor(textRect, rootRect, tolerance);
    if (canvasOverflow && !hasAllowOverflowFlag(element)) {
      issues.push({
        code: "canvas_overflow",
        severity: "info",
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

  function hasAllowOverlapFlag(element) {
    return !!element.closest("[data-layout-allow-overlap]");
  }

  function isTransparentColor(color) {
    return (
      !color || color === "transparent" || color === "rgba(0, 0, 0, 0)" || color.endsWith(", 0)")
    );
  }

  function alphaFromParts(parts, index) {
    return parts.length > index ? parsePx(parts[index]) : 1;
  }

  // Alpha of a CSS colour; 1 when no alpha component is present. Handles both
  // legacy `rgba(r, g, b, a)` and modern `rgb(r g b / a)` syntaxes.
  function colorAlpha(color) {
    const match = (color || "").match(/rgba?\(([^)]+)\)/);
    if (!match) return 1;
    const body = match[1];
    return body.includes(",")
      ? alphaFromParts(body.split(","), 3)
      : alphaFromParts(body.split("/"), 1);
  }

  // A text block competes for space only when it is solid: watermark-style text
  // (low colour alpha) is decorative and exempt, as are elements opted out with
  // data-layout-allow-overlap.
  function isSolidTextBlock(element) {
    if (!isVisibleElement(element) || !hasOwnTextCandidate(element)) return false;
    if (hasAllowOverlapFlag(element)) return false;
    return colorAlpha(getComputedStyle(element).color) >= 0.35;
  }

  function collectSolidTextBlocks(root) {
    const blocks = [];
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (!isSolidTextBlock(element)) continue;
      const rect = textRectFor(element);
      if (rect) blocks.push({ element, rect });
    }
    return blocks;
  }

  function rectArea(rect) {
    return rect.width * rect.height;
  }

  function intersectionArea(a, b) {
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
  }

  function isNested(a, b) {
    return a.contains(b) || b.contains(a);
  }

  // Two solid text blocks whose boxes overlap by more than a fifth of the
  // smaller block read as a collision — unreadable, and invisible to the
  // overflow checks, which only compare an element against its container.
  function overlapIssue(a, b, time) {
    if (isNested(a.element, b.element)) return null;
    const area = intersectionArea(a.rect, b.rect);
    if (area <= Math.min(rectArea(a.rect), rectArea(b.rect)) * 0.2) return null;
    return {
      // Warning, not error: must not fail the exit code (ok = errorCount === 0)
      // for compositions that intentionally layer text. Re-promote once the
      // data-layout-allow-overlap opt-out is widely adopted.
      code: "content_overlap",
      severity: "warning",
      time,
      selector: selectorFor(a.element),
      containerSelector: selectorFor(b.element),
      text: textContentFor(a.element),
      message: "Two text blocks overlap and may render unreadable.",
      rect: a.rect,
      fixHint:
        "Give each block its own zone, or mark intentional layering with data-layout-allow-overlap.",
    };
  }

  function contentOverlapIssues(root, time) {
    const blocks = collectSolidTextBlocks(root);
    const issues = [];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const issue = overlapIssue(blocks[i], blocks[j], time);
        if (issue) issues.push(issue);
      }
    }
    return issues;
  }

  function hasOpaqueBackground(style) {
    if (style.backgroundImage && style.backgroundImage !== "none") return true;
    if (isTransparentColor(style.backgroundColor)) return false;
    return colorAlpha(style.backgroundColor) > 0.6;
  }

  const RASTER_TAGS = new Set(["IMG", "VIDEO", "CANVAS"]);

  // An element hides text beneath it when it paints opaque pixels at near-full
  // opacity: raster content (img/video/canvas), a background image, or a solid
  // background colour. Low-opacity overlays (grain, scrims) do not occlude.
  function isOpaqueOccluder(element) {
    if (opacityChain(element) < 0.6) return false;
    if (IGNORE_TAGS.has(element.tagName)) return false;
    if (RASTER_TAGS.has(element.tagName)) return true;
    return hasOpaqueBackground(getComputedStyle(element));
  }

  function hasAllowOcclusionFlag(element) {
    return !!element.closest("[data-layout-allow-occlusion]");
  }

  // A foreign element is one painted independently of the text — not the text
  // itself, its own subtree, or an ancestor it shares a background with.
  function isForeignElement(element, hit) {
    return !!hit && hit !== element && !element.contains(hit) && !hit.contains(element);
  }

  // The opaque element painted over (x, y), or null when the topmost element
  // there is related to the text or non-opaque.
  function occluderAt(element, x, y) {
    if (typeof document.elementFromPoint !== "function") return null;
    const hit = document.elementFromPoint(x, y);
    if (!isForeignElement(element, hit)) return null;
    return isOpaqueOccluder(hit) ? hit : null;
  }

  // Sweep a grid across the text box (three rows, not just the mid-line, so
  // overlays covering only part of a multi-line block are caught) and return
  // the first opaque element painted over any sample point.
  function firstOccluder(element, textRect) {
    for (const yFraction of [0.25, 0.5, 0.75]) {
      const y = textRect.top + textRect.height * yFraction;
      for (const xFraction of [0.03, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.97]) {
        const occluder = occluderAt(element, textRect.left + textRect.width * xFraction, y);
        if (occluder) return occluder;
      }
    }
    return null;
  }

  // Catches the blind spot the overflow checks miss: text that fits its box
  // perfectly but is covered by a later sibling/overlay.
  function occludedTextIssue(element, time) {
    if (hasAllowOcclusionFlag(element)) return null;
    const textRect = textRectFor(element);
    if (!textRect) return null;
    const occluder = firstOccluder(element, textRect);
    if (!occluder) return null;
    return {
      code: "text_occluded",
      severity: "error",
      time,
      selector: selectorFor(element),
      containerSelector: selectorFor(occluder),
      text: textContentFor(element),
      message: "Text is hidden beneath an opaque element.",
      rect: textRect,
      fixHint:
        "Give the text its own zone, raise its stacking order above the covering element, or mark intentional layering with data-layout-allow-occlusion.",
    };
  }

  window.__hyperframesLayoutAudit = function auditLayout(options) {
    const time = options && typeof options.time === "number" ? options.time : 0;
    const tolerance =
      options && typeof options.tolerance === "number" ? Math.max(0, options.tolerance) : 2;
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const rootRect = rootRectFor(root);
    const elements = Array.from(root.querySelectorAll("*")).filter(isVisibleElement);
    const issues = [];

    for (const element of elements) {
      if (!hasOwnTextCandidate(element)) continue;
      const clipped = clippedTextIssue(element, time, tolerance);
      if (clipped) issues.push(clipped);
      issues.push(...textOverflowIssues(element, root, rootRect, time, tolerance));
      const occluded = occludedTextIssue(element, time);
      if (occluded) issues.push(occluded);
    }

    issues.push(...containerOverflowIssues(root, time, tolerance));
    issues.push(...contentOverlapIssues(root, time));
    return issues;
  };
})();
