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

  function horizontalOverflow(subject, container, tolerance) {
    if (subject.width <= container.width + tolerance) return null;
    const overflow = overflowFor(subject, container, tolerance);
    if (!overflow) return null;
    const horizontal = {};
    if (overflow.left != null) horizontal.left = overflow.left;
    if (overflow.right != null) horizontal.right = overflow.right;
    return Object.keys(horizontal).length > 0 ? horizontal : null;
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

  function uniqueSelectorFor(element) {
    const preferred = selectorFor(element);
    try {
      if (document.querySelectorAll(preferred).length === 1) return preferred;
    } catch {
      // Fall through to a structural selector.
    }
    const parent = element.parentElement;
    if (!parent) return preferred;
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === element.tagName,
    );
    const index = siblings.indexOf(element) + 1;
    return `${uniqueSelectorFor(parent)} > ${element.tagName.toLowerCase()}:nth-of-type(${index})`;
  }

  // Color grading paints an <img>/<video> into a canvas the runtime inserts right after it; that canvas answers
  // to the element the author wrote. ponytail: render-frame siblings sit between them only in render, not check.
  const GRADED_STAND_IN = "[data-hf-color-grading-canvas]";
  function authoredElement(element) {
    return (element.matches(GRADED_STAND_IN) && element.previousElementSibling) || element;
  }

  function hasIgnoreFlag(element) {
    return !!authoredElement(element).closest("[data-layout-ignore], [data-layout-check='ignore']");
  }

  function hasAllowOverflowFlag(element) {
    return !!authoredElement(element).closest("[data-layout-allow-overflow]");
  }

  function hasAllowCaptionZoneFlag(element) {
    return !!authoredElement(element).closest("[data-layout-allow-caption-zone]");
  }

  function hasTextClipOptOut(element) {
    return (
      hasAllowOverflowFlag(element) || authoredElement(element).hasAttribute("data-layout-bleed")
    );
  }

  function opacityChain(element) {
    let opacity = 1;
    for (let current = element; current; current = current.parentElement) {
      const parsed = Number.parseFloat(getComputedStyle(current).opacity || "1");
      if (Number.isFinite(parsed)) opacity *= parsed;
    }
    return opacity;
  }

  function hasOpacityBelow(element, floor) {
    for (let current = element; current; current = current.parentElement) {
      const parsed = Number.parseFloat(getComputedStyle(current).opacity || "1");
      if (Number.isFinite(parsed) && parsed < floor) return true;
    }
    return false;
  }

  // A clip-path can shrink an element's painted region to nothing (e.g. a
  // typewriter span pre-reveal at `inset(0 100% 0 0)`, or `circle(0px)`) while
  // its layout box, opacity, visibility and display all still read as present.
  // Such an element paints zero pixels, so flagging it for overlap/occlusion is
  // a false positive. clip-path also drives hit-testing, so an element clipped
  // to nothing is unreachable by elementFromPoint anywhere in its box; only run
  // the probe when a clip-path is actually in effect (self or ancestor) to avoid
  // mistaking a genuinely-occluded element for a clipped one.
  function hasClipPath(element) {
    for (let current = element; current; current = current.parentElement) {
      const clip = getComputedStyle(current).clipPath;
      if (clip && clip !== "none") return true;
    }
    return false;
  }

  const CLIP_PROBE_COLS = [0.05, 0.25, 0.5, 0.75, 0.95];
  const CLIP_PROBE_ROWS = [0.25, 0.5, 0.75];

  function paintsAnyProbePoint(element, rect) {
    // Probe resolution intentionally treats edge strips narrower than the
    // nearest probe point as clipped away. That avoids noisy reports for
    // typewriter pre-reveal states; if a real visible-strip bug appears, add
    // edge probes here before widening the audit surface.
    for (const fx of CLIP_PROBE_COLS) {
      for (const fy of CLIP_PROBE_ROWS) {
        const hit = document.elementFromPoint(
          rect.left + rect.width * fx,
          rect.top + rect.height * fy,
        );
        if (hit === element || element.contains(hit)) return true;
      }
    }
    return false;
  }

  function isClippedAway(element) {
    if (typeof document.elementFromPoint !== "function") return false;
    if (!hasClipPath(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0.5 || rect.height <= 0.5) return false;
    return !paintsAnyProbePoint(element, rect);
  }

  function isVisibleElement(element, opacityFloor, probeClipPath) {
    if (IGNORE_TAGS.has(element.tagName)) return false;
    if (hasIgnoreFlag(element)) return false;
    if (typeof element.checkVisibility === "function") {
      // Without a floor the plain call still drops content the page does not render, such as a closed <details>.
      const options =
        opacityFloor != null
          ? { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }
          : {};
      if (!element.checkVisibility(options)) return false;
    }
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }
    if (
      opacityFloor == null ? opacityChain(element) < 0.2 : hasOpacityBelow(element, opacityFloor)
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0.5 || rect.height <= 0.5) return false;
    return probeClipPath === false || !isClippedAway(element);
  }

  function directTextNodes(element) {
    return Array.from(element.childNodes).filter((node) => node.nodeType === 3);
  }

  function textContentFor(element, ownTextOnly) {
    const content = ownTextOnly
      ? directTextNodes(element)
          .map((node) => node.textContent || "")
          .join("")
      : element.innerText || element.textContent || "";
    return content.replace(/\s+/g, " ").trim();
  }

  function hasOwnTextCandidate(element, directOnly) {
    const text = textContentFor(element, directOnly);
    if (!text) return false;
    if (directOnly) return true;
    // Aggregate text may come exclusively from descendants (including hidden
    // captions). The container itself does not paint that text and must not be
    // audited as though it did.
    return textContentFor(element, true).length > 0;
  }

  function textClientRects(element, directOnly) {
    const subjects = directOnly ? directTextNodes(element) : [element];
    const rects = [];
    for (const subject of subjects) {
      const range = document.createRange();
      range.selectNodeContents(subject);
      rects.push(
        ...Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0.5 && rect.height > 0.5,
        ),
      );
      range.detach();
    }
    return rects;
  }

  function unionRects(rects) {
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

  function visibleTextClientRects(element, directOnly) {
    // Range rects stay geometrically present outside an overflow clip. Reduce
    // them in viewport coordinates so overlap measures only paintable text.
    let rects = textClientRects(element, directOnly).map(toRect);
    for (
      let ancestor = element.parentElement;
      ancestor && rects.length > 0;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const clipX = clipsOverflowValue(style.overflowX || style.overflow);
      const clipY = clipsOverflowValue(style.overflowY || style.overflow);
      if (!clipX && !clipY) continue;
      const clip = toRect(ancestor.getBoundingClientRect());
      rects = rects
        .map((rect) => {
          const left = clipX ? Math.max(rect.left, clip.left) : rect.left;
          const right = clipX ? Math.min(rect.right, clip.right) : rect.right;
          const top = clipY ? Math.max(rect.top, clip.top) : rect.top;
          const bottom = clipY ? Math.min(rect.bottom, clip.bottom) : rect.bottom;
          if (right - left <= 0.5 || bottom - top <= 0.5) return null;
          return toRect({ left, right, top, bottom, width: right - left, height: bottom - top });
        })
        .filter(Boolean);
    }
    return rects;
  }

  function textRectFor(element, directOnly) {
    return unionRects(textClientRects(element, directOnly));
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

  function clipsOverflowValue(value) {
    return value && value !== "visible" && value !== "clip visible";
  }

  function clipsOverflow(style) {
    return [style.overflowX, style.overflowY, style.overflow].some((value) =>
      clipsOverflowValue(value),
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
    if (hasTextClipOptOut(element)) return null;
    const style = getComputedStyle(element);
    if (!clipsOverflow(style)) return null;
    const overflowX = element.scrollWidth - element.clientWidth;
    const overflowY = element.scrollHeight - element.clientHeight;
    if (overflowX <= tolerance && overflowY <= tolerance) return null;
    const overflow = {};
    if (overflowX > tolerance) overflow.right = round(overflowX);
    if (overflowY > tolerance) overflow.bottom = round(overflowY);
    const selector = uniqueSelectorFor(element);
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

  function capitalizeWords(text) {
    const words = new Intl.Segmenter(undefined, { granularity: "word" }).segment(text);
    return Array.from(words, ({ segment, isWordLike }) => {
      if (!isWordLike) return segment;
      const [first, ...rest] = segment;
      return first.toUpperCase() + rest.join("");
    }).join("");
  }

  function horizontalTextMetrics(element, style) {
    if (style.writingMode && style.writingMode !== "horizontal-tb") return null;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return null;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    let text = textContentFor(element, true);
    if (style.textTransform === "uppercase") text = text.toUpperCase();
    if (style.textTransform === "lowercase") text = text.toLowerCase();
    if (style.textTransform === "capitalize") text = capitalizeWords(text);
    const metrics = context.measureText(text);
    return metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent > 0 ? metrics : null;
  }

  function intersectsTextWindow(rect, clip, tolerance) {
    return (
      Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left) > tolerance &&
      Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top) > tolerance
    );
  }

  // The glyphs' own extent inside a Range rect (the font's content area); font metrics scale with the rect.
  function inkRect(rect, metrics) {
    const scale = rect.height / (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
    const top =
      rect.top + (metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent) * scale;
    const bottom =
      rect.bottom - (metrics.fontBoundingBoxDescent - metrics.actualBoundingBoxDescent) * scale;
    return { ...rect, top, bottom, height: bottom - top };
  }

  function visibleTextLineRects(element, rects, style, clip, tolerance) {
    const metrics = horizontalTextMetrics(element, style);
    return rects.flatMap((rect) => {
      if (!metrics) return intersectsTextWindow(rect, clip, tolerance) ? [rect] : [];
      // The glyphs' ink is what a clip cuts; a line box with negative leading hides descenders from it.
      const ink = inkRect(rect, metrics);
      return intersectsTextWindow(ink, clip, tolerance) ? [toRect(ink)] : [];
    });
  }

  function textOverflowIssues(element, root, rootRect, time, tolerance, clippedIssue) {
    const lineRects = textClientRects(element, true).map(toRect);
    const textRect = unionRects(lineRects);
    if (!textRect) return [];
    const text = textContentFor(element, true);
    const selector = uniqueSelectorFor(element);
    const issues = [];

    const container = nearestConstraint(element, root, rootRect);
    const containerRect = container === root ? rootRect : toRect(container.getBoundingClientRect());
    const elementStyle = getComputedStyle(element);
    const containerClips = clipsOverflow(
      container === root ? getComputedStyle(root) : getComputedStyle(container),
    );
    const visibleTextRect = containerClips
      ? unionRects(visibleTextLineRects(element, lineRects, elementStyle, containerRect, tolerance))
      : textRect;
    const verticalTolerance = containerClips
      ? tolerance
      : Math.max(tolerance, parsePx(elementStyle.fontSize) * 0.2);
    const containerOverflow = visibleTextRect
      ? overflowFor(visibleTextRect, containerRect, tolerance, verticalTolerance)
      : null;
    const billedAsClippedText =
      container === element &&
      clippedIssue != null &&
      containerOverflow != null &&
      containerOverflow.left == null &&
      containerOverflow.top == null;
    if (containerOverflow && !billedAsClippedText && !hasTextClipOptOut(element)) {
      const style = elementStyle;
      issues.push({
        code: "text_box_overflow",
        severity: "error",
        time,
        selector,
        containerSelector: uniqueSelectorFor(container),
        text,
        message: "Text extends outside its nearest visual/container box.",
        rect: visibleTextRect,
        containerRect,
        overflow: containerOverflow,
        fixHint: textOverflowFixHint(
          visibleTextRect,
          containerRect,
          containerOverflow,
          parsePx(style.fontSize),
          "the container",
        ),
      });
    }

    const canvasOverflow = overflowFor(textRect, rootRect, tolerance);
    if (canvasOverflow && !hasTextClipOptOut(element)) {
      issues.push({
        code: "canvas_overflow",
        severity: "info",
        time,
        selector,
        containerSelector: uniqueSelectorFor(root),
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

  function isNowrapTextChild(child) {
    if (!isVisibleElement(child) || hasAllowOverflowFlag(child)) return false;
    if (getComputedStyle(child).whiteSpace !== "nowrap") return false;
    return (child.textContent || "").trim().length > 0;
  }

  function hasNowrapTextChild(element) {
    return Array.from(element.children).some(isNowrapTextChild);
  }

  function containerOverflowIssues(root, time, tolerance) {
    const issues = [];
    const containers = Array.from(root.querySelectorAll("*")).filter((element) => {
      if (!isVisibleElement(element) || hasAllowOverflowFlag(element)) return false;
      const style = getComputedStyle(element);
      return (
        clipsOverflow(style) ||
        element.hasAttribute("data-layout-boundary") ||
        hasNowrapTextChild(element)
      );
    });

    for (const container of containers) {
      const style = getComputedStyle(container);
      const checksEveryChild =
        clipsOverflow(style) || container.hasAttribute("data-layout-boundary");
      const containerRect = toRect(container.getBoundingClientRect());
      for (const child of Array.from(container.children)) {
        if (!isVisibleElement(child) || hasAllowOverflowFlag(child)) continue;
        if (!checksEveryChild && !isNowrapTextChild(child)) continue;
        const childRect = toRect(child.getBoundingClientRect());
        const overflow = checksEveryChild
          ? overflowFor(childRect, containerRect, tolerance)
          : horizontalOverflow(childRect, containerRect, tolerance);
        if (!overflow) continue;
        issues.push({
          code: "container_overflow",
          severity: "warning",
          time,
          selector: uniqueSelectorFor(child),
          containerSelector: uniqueSelectorFor(container),
          message: checksEveryChild
            ? "Element extends outside a clipping layout container."
            : "Nowrap text is wider than its container.",
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
    // The marker applies to the element that carries it and to text inside
    // that container. It stops at the composition root: a waiver on the scene
    // itself would exempt every collision in the subtree.
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute("data-composition-id")) return false;
      if (current.hasAttribute("data-layout-allow-overlap")) return true;
    }
    return false;
  }

  function isTransparentColor(color) {
    return (
      !color || color === "transparent" || color === "rgba(0, 0, 0, 0)" || color.endsWith(", 0)")
    );
  }

  function alphaFromParts(parts, index) {
    if (parts.length <= index) return 1;
    const raw = parts[index].trim();
    return raw.endsWith("%") ? parsePx(raw) / 100 : parsePx(raw);
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
    if (!isVisibleElement(element) || !hasOwnTextCandidate(element, true)) return false;
    if (hasAllowOverlapFlag(element)) return false;
    return colorAlpha(getComputedStyle(element).color) >= 0.35;
  }

  const RUNTIME_HIDDEN_CLIP = "[data-hf-clip-hidden]";

  // Core's timedClipHide rule hides these clips' whole subtrees: skipping them bounds work by what is on screen.
  function elementsOnScreenScenes(root) {
    const elements = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (element) =>
        element.matches(RUNTIME_HIDDEN_CLIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let element = walker.nextNode(); element; element = walker.nextNode()) {
      elements.push(element);
    }
    return elements;
  }

  function collectSolidTextBlocks(root) {
    const blocks = [];
    for (const element of elementsOnScreenScenes(root)) {
      if (!isSolidTextBlock(element)) continue;
      const rects = visibleTextClientRects(element, true);
      const rect = unionRects(rects);
      if (rect) blocks.push({ element, rect, rects });
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

  function rectsArea(rects) {
    return rects.reduce((total, rect) => total + rectArea(rect), 0);
  }

  function fragmentIntersectionArea(a, b) {
    let total = 0;
    for (const aRect of a) {
      for (const bRect of b) total += intersectionArea(aRect, bRect);
    }
    return total;
  }

  function overlapsByAFifth(a, b) {
    return fragmentIntersectionArea(a, b) > Math.min(rectsArea(a), rectsArea(b)) * 0.2;
  }

  // Collision is judged on the glyphs: at line-height < 1 the content areas of stacked lines overlap
  // while the words do not touch. Measured only for pairs whose content areas already overlap.
  function glyphRects(block) {
    if (!block.glyphRects) {
      const metrics = horizontalTextMetrics(block.element, getComputedStyle(block.element));
      block.glyphRects = metrics ? block.rects.map((rect) => inkRect(rect, metrics)) : block.rects;
    }
    return block.glyphRects;
  }

  function isNested(a, b) {
    return a.contains(b) || b.contains(a);
  }

  function isInFlow(element) {
    const position = getComputedStyle(element).position;
    return position === "static" || position === "relative" || position === "sticky";
  }

  function nearestFlexGridAncestor(element) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const display = getComputedStyle(parent).display;
      if (display.includes("flex") || display.includes("grid")) return parent;
    }
    return null;
  }

  // Two in-flow text blocks governed by the same flex/grid container are placed
  // by the layout engine, which reserves space for each — they cannot visually
  // collide. Any measured text-rect overlap between them is line-box / leading
  // slop (tight stacks, number lockups, super/subscript units), not a collision.
  // A real overlap bug needs free positioning (absolute/fixed), which keeps a
  // different formatting context and is still flagged.
  function isManagedFlowOverlap(a, b) {
    if (!isInFlow(a) || !isInFlow(b)) return false;
    const container = nearestFlexGridAncestor(a);
    return !!container && container === nearestFlexGridAncestor(b);
  }

  // Two solid text blocks whose boxes overlap by more than a fifth of the
  // smaller block read as a collision — unreadable, and invisible to the
  // overflow checks, which only compare an element against its container.
  function overlapIssue(a, b, time) {
    if (isNested(a.element, b.element)) return null;
    if (isManagedFlowOverlap(a.element, b.element)) return null;
    if (!overlapsByAFifth(a.rects, b.rects)) return null;
    if (!overlapsByAFifth(glyphRects(a), glyphRects(b))) return null;
    return {
      // Warning at the per-sample level: a single-sample overlap is usually an
      // entrance/exit transient (two blocks crossing mid-animation), not a real
      // collision. `collapseStaticLayoutIssues` (utils/layoutAudit.ts) re-promotes
      // this to error once the SAME overlap is held across >= 2 adjacent samples
      // (or ~500ms of timeline) — a persistence-tiered replacement for the old
      // "re-promote once data-layout-allow-overlap is widely adopted" plan (#U10).
      code: "content_overlap",
      severity: "warning",
      time,
      selector: uniqueSelectorFor(a.element),
      containerSelector: uniqueSelectorFor(b.element),
      text: textContentFor(a.element),
      message: "Two text blocks overlap and may render unreadable.",
      rect: a.rect,
      fixHint:
        "Give each block its own zone, or put data-layout-allow-overlap on the text or on a container inside the scene. A marker on the scene root does not apply.",
    };
  }

  function hiddenVisibilityAncestor(element) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const visibility = getComputedStyle(parent).visibility;
      if (visibility === "hidden" || visibility === "collapse") return parent;
    }
    return null;
  }

  function visibilityEscapeIssue(block, hiddenAncestor, time) {
    return {
      code: "visibility_escapes_segment",
      severity: "warning",
      time,
      selector: uniqueSelectorFor(block.element),
      containerSelector: uniqueSelectorFor(hiddenAncestor),
      text: textContentFor(block.element),
      message:
        "This text stays on screen after its segment ends. visibility:visible here overrides an ancestor's visibility:hidden, so the runtime hide does not reach it.",
      rect: block.rect,
      fixHint: "Remove the explicit visibility:visible so this element hides with its ancestor.",
    };
  }

  function contentOverlapIssues(root, time) {
    const blocks = collectSolidTextBlocks(root);
    const issues = [];
    const participating = [];
    for (const block of blocks) {
      const hiddenAncestor = hiddenVisibilityAncestor(block.element);
      if (hiddenAncestor) {
        issues.push(visibilityEscapeIssue(block, hiddenAncestor, time));
        continue;
      }
      participating.push(block);
    }
    for (let i = 0; i < participating.length; i++) {
      for (let j = i + 1; j < participating.length; j++) {
        const issue = overlapIssue(participating[i], participating[j], time);
        if (issue) issues.push(issue);
      }
    }
    return issues;
  }

  function hasOpaqueBackground(style) {
    let imageAlpha = 0;
    if (style.backgroundImage && style.backgroundImage !== "none") {
      if (style.backgroundImage.includes("url(")) return true;
      // A gradient only occludes as much as its colours — a 4%-alpha grid/scrim
      // must not count, and neither must a solid-color dot a couple of pixels
      // wide tiled across a much larger background-size.
      imageAlpha = gradientLayersAlpha(style.backgroundImage, style.backgroundSize);
    }
    const colorValue = isTransparentColor(style.backgroundColor)
      ? 0
      : colorAlpha(style.backgroundColor);
    // Layers composite: a 0.5 gradient over a 0.5 background colour paints at ~0.75.
    return 1 - (1 - imageAlpha) * (1 - colorValue) > 0.6;
  }

  // background-image layers stack: two 0.5-alpha gradients paint at 1-(1-.5)^2 = .75.
  function gradientLayersAlpha(backgroundImage, backgroundSize) {
    let combined = 0;
    for (const layer of splitTopLevelCommas(backgroundImage)) {
      const coverage = gradientStopCoverage(layer, backgroundSize);
      combined = 1 - (1 - combined) * (1 - gradientMaxAlpha(layer) * coverage);
    }
    return combined;
  }

  // Share of a radial dot's tile. A linear fill, or an opaque stop after a
  // transparent one, stays fully painted. A 1.6px dot on a 38px tile does not.
  function gradientStopCoverage(layer, backgroundSize) {
    if (!/radial-gradient/i.test(layer) || namesAColor(withoutScoredColors(layer))) return 1;
    const stops = [
      ...layer.matchAll(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|transparent)\s+([\d.]+)(px|%)/gi),
    ];
    const tile = pxTile(backgroundSize);
    const reach = tile ? leadingOpaqueRadius(stops, tile) : null;
    if (reach === null) return 1;
    return Math.min(1, (Math.PI * reach * reach) / (tile * tile));
  }

  function pxTile(backgroundSize) {
    const sizeMatch = String(backgroundSize || "").match(/([\d.]+)px/);
    return sizeMatch ? Number(sizeMatch[1]) : 0;
  }

  function leadingOpaqueRadius(stops, tile) {
    const walked = walkOpaquePrefix(stops, tile);
    if (!walked || !walked.sawOpaque || !walked.sawTransparent) return null;
    return walked.reach;
  }

  function walkOpaquePrefix(stops, tile) {
    const state = { reach: 0, sawOpaque: false, sawTransparent: false };
    for (const stop of stops) {
      if (!takeRadiusStop(state, stop, tile)) return null;
    }
    return state;
  }

  function takeRadiusStop(state, stop, tile) {
    if (stopAlpha(stop[1] || "") <= 0.6) {
      state.sawTransparent = true;
      return true;
    }
    if (state.sawTransparent) return false;
    state.sawOpaque = true;
    state.reach = Math.max(state.reach, stopLength(stop, tile));
    return true;
  }

  function stopAlpha(color) {
    if (color === "transparent") return 0;
    if (color.startsWith("#")) return 1;
    return colorAlpha(color);
  }

  function stopLength(stop, tile) {
    return stop[3] === "%" ? (Number(stop[2]) / 100) * tile : Number(stop[2]);
  }

  function splitTopLevelCommas(value) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === "," && depth === 0) {
        parts.push(value.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(value.slice(start));
    return parts;
  }

  function gradientMaxAlpha(backgroundImage) {
    // Any colour we cannot score (oklch/lab/named-colour fns/...) counts as opaque so real panels keep flagging.
    const known = backgroundImage
      .replace(/(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi, "(")
      .replace(/rgba?\([^)]*\)/gi, "");
    if (/[a-z][a-z-]+\(/i.test(known)) return 1;
    if (namesAColor(known)) return 1;
    const colors = backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b|\btransparent\b/g);
    if (!colors) return 1;
    let max = 0;
    for (const color of colors) {
      if (color === "transparent") continue;
      if (color.startsWith("#")) {
        const hex = color.slice(1);
        max = Math.max(
          max,
          hex.length === 4
            ? parseInt(hex[3] + hex[3], 16) / 255
            : hex.length === 8
              ? parseInt(hex.slice(6), 16) / 255
              : 1,
        );
      } else {
        max = Math.max(max, colorAlpha(color));
      }
    }
    return max;
  }

  function withoutScoredColors(layer) {
    return layer.replace(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g, " ");
  }

  function namesAColor(known) {
    const words = known.replace(
      /\b(?:to|top|bottom|left|right|center|circle|ellipse|closest-side|farthest-side|closest-corner|farthest-corner|from|deg|rad|turn|grad|transparent|repeating|linear|radial|conic|gradient)\b/gi,
      " ",
    );
    return /\b[a-z]{3,}\b/i.test(words);
  }

  const RASTER_TAGS = new Set(["IMG", "VIDEO", "CANVAS"]);
  const FRAME_MEDIA_TAGS = new Set([...RASTER_TAGS, "SVG"]);
  const imageAlphaCanvases = new WeakMap();

  function objectPositionOffset(value, freeSpace) {
    const token = String(value || "50%")
      .trim()
      .split(/\s+/)[0];
    if (token === "left" || token === "top") return 0;
    if (token === "right" || token === "bottom") return freeSpace;
    if (token === "center") return freeSpace / 2;
    if (token.endsWith("%")) return (freeSpace * parseFloat(token)) / 100;
    const pixels = parseFloat(token);
    return Number.isFinite(pixels) ? pixels : freeSpace / 2;
  }

  function objectPositionOffsets(value, freeX, freeY) {
    const tokens = String(value || "50% 50%")
      .trim()
      .split(/\s+/)
      .slice(0, 2);
    let x = "50%";
    let y = "50%";
    if (tokens.length === 1) {
      if (tokens[0] === "top" || tokens[0] === "bottom") y = tokens[0];
      else x = tokens[0];
    } else {
      for (const token of tokens) {
        if (token === "top" || token === "bottom") y = token;
        else if (token === "left" || token === "right") x = token;
        else if (x === "50%") x = token;
        else y = token;
      }
    }
    return { x: objectPositionOffset(x, freeX), y: objectPositionOffset(y, freeY) };
  }

  const IDENTITY_FLIP = { flipX: false, flipY: false };

  // 2D CSS matrix components [a, b, c, d], or null when the transform is 3D or unparsed.
  function transformMatrix(value) {
    if (!value || value === "none") return [1, 0, 0, 1];
    const match = /^matrix\(([^)]*)\)$/.exec(value.trim());
    if (!match) return null;
    const parts = match[1].split(",").map(Number);
    return parts.length === 6 && parts.every(Number.isFinite) ? parts.slice(0, 4) : null;
  }

  // Which axes the element's paint is mirrored on, or null when a rotation, skew or 3D transform
  // (on it or an ancestor) means its bounding box no longer maps axis-aligned onto its pixels.
  function paintFlips(element) {
    let flipX = false;
    let flipY = false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      const matrix = transformMatrix(style.transform);
      if (!matrix) return null;
      const [a, b, c, d] = matrix;
      if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return null;
      if (style.rotate && style.rotate !== "none" && parseFloat(style.rotate) !== 0) return null;
      const scale = String(style.scale || "none")
        .trim()
        .split(/\s+/)
        .map(Number);
      const scaleX = Number.isFinite(scale[0]) ? scale[0] : 1;
      const scaleY = Number.isFinite(scale[1]) ? scale[1] : scaleX;
      if (a * scaleX < 0) flipX = !flipX;
      if (d * scaleY < 0) flipY = !flipY;
    }
    return flipX || flipY ? { flipX, flipY } : IDENTITY_FLIP;
  }

  function paintedSourceMapping(element, sourceWidth, sourceHeight) {
    const rect = element.getBoundingClientRect();
    if (!sourceWidth || !sourceHeight || !rect.width || !rect.height) return null;
    const flips = paintFlips(element);
    if (!flips) return null;

    const style = getComputedStyle(element);
    const fit = style.objectFit || "fill";
    let scaleX = rect.width / sourceWidth;
    let scaleY = rect.height / sourceHeight;
    if (fit !== "fill") {
      const contain = Math.min(scaleX, scaleY);
      const cover = Math.max(scaleX, scaleY);
      const scale =
        fit === "cover"
          ? cover
          : fit === "none"
            ? 1
            : fit === "scale-down"
              ? Math.min(1, contain)
              : contain;
      scaleX = scale;
      scaleY = scale;
    }

    const paintedWidth = sourceWidth * scaleX;
    const paintedHeight = sourceHeight * scaleY;
    const offsets = objectPositionOffsets(
      style.objectPosition,
      rect.width - paintedWidth,
      rect.height - paintedHeight,
    );
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      offsets,
      ...flips,
      paintedWidth,
      paintedHeight,
      scaleX,
      scaleY,
      sourceWidth,
      sourceHeight,
    };
  }

  // The source pixel painted at a viewport point, or null outside the painted content box.
  function sourcePixelAt(mapping, x, y) {
    const { rect, offsets } = mapping;
    const localX = (mapping.flipX ? rect.right - x : x - rect.left) - offsets.x;
    const localY = (mapping.flipY ? rect.bottom - y : y - rect.top) - offsets.y;
    if (
      localX < 0 ||
      localY < 0 ||
      localX >= mapping.paintedWidth ||
      localY >= mapping.paintedHeight
    ) {
      return null;
    }
    return {
      x: Math.min(mapping.sourceWidth - 1, Math.max(0, Math.floor(localX / mapping.scaleX))),
      y: Math.min(mapping.sourceHeight - 1, Math.max(0, Math.floor(localY / mapping.scaleY))),
    };
  }

  // Return the alpha painted by an <img> at a viewport point. `null` means the
  // browser would not let us inspect the image (not loaded or cross-origin), in
  // which case callers preserve the conservative opaque fallback.
  function imageAlphaAt(element, x, y) {
    const sourceWidth = element.naturalWidth;
    const sourceHeight = element.naturalHeight;
    const mapping = paintedSourceMapping(element, sourceWidth, sourceHeight);
    if (!mapping) return null;
    const pixel = sourcePixelAt(mapping, x, y);
    if (!pixel) return 0;

    try {
      let cached = imageAlphaCanvases.get(element);
      const source = element.currentSrc || element.src;
      if (
        !cached ||
        cached.width !== sourceWidth ||
        cached.height !== sourceHeight ||
        cached.source !== source
      ) {
        const canvas = document.createElement("canvas");
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(element, 0, 0, sourceWidth, sourceHeight);
        cached = { context, width: sourceWidth, height: sourceHeight, source };
        imageAlphaCanvases.set(element, cached);
      }
      return cached.context.getImageData(pixel.x, pixel.y, 1, 1).data[3] / 255;
    } catch {
      return null;
    }
  }

  const OCCLUDING_ALPHA = 0.6;
  const VIDEO_ALPHA_MAX_SIDE = 480;
  let videoAlphaFrames = new Map();
  let videoAlphaScratch = null;

  function videoAlphaContext(width, height) {
    if (!videoAlphaScratch) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      videoAlphaScratch = { canvas, context };
    }
    videoAlphaScratch.canvas.width = width;
    videoAlphaScratch.canvas.height = height;
    return videoAlphaScratch.context;
  }

  // Read once per audit call, so per sample time, and only for a video some text probe lands under.
  function videoAlphaFrame(video) {
    let frame = videoAlphaFrames.get(video);
    if (!frame) {
      frame = readVideoAlphaFrame(video);
      videoAlphaFrames.set(video, frame);
    }
    return frame;
  }

  function unreadVideoFrame(reason) {
    return { kind: "unread", reason };
  }

  // "opaque" keeps a video's whole box occluding; "matte" judges each point by the decoded
  // frame's alpha; "unread" falls back to opaque and is reported, never guessed.
  function readVideoAlphaFrame(video) {
    if (video.seeking) return unreadVideoFrame("the seek had not landed");
    if (video.readyState < 2) return unreadVideoFrame("no frame was decoded at this time");
    if (!video.videoWidth || !video.videoHeight)
      return unreadVideoFrame("the video has no frame size");
    const mapping = paintedSourceMapping(video, video.videoWidth, video.videoHeight);
    if (!mapping) return unreadVideoFrame("it is rotated, skewed or transformed in 3D");
    const downscale = Math.min(
      1,
      VIDEO_ALPHA_MAX_SIDE / Math.max(mapping.sourceWidth, mapping.sourceHeight),
    );
    const width = Math.max(1, Math.round(mapping.sourceWidth * downscale));
    const height = Math.max(1, Math.round(mapping.sourceHeight * downscale));
    let rgba;
    try {
      const context = videoAlphaContext(width, height);
      if (!context) return unreadVideoFrame("no 2D canvas was available");
      context.clearRect(0, 0, width, height);
      context.drawImage(video, 0, 0, width, height);
      rgba = context.getImageData(0, 0, width, height).data;
    } catch (error) {
      return unreadVideoFrame(
        error && error.name === "SecurityError"
          ? "its source is cross-origin"
          : "its frame could not be drawn",
      );
    }
    return classifyVideoAlpha(rgba, width, height, mapping, opacityChain(video));
  }

  function classifyVideoAlpha(rgba, width, height, mapping, opacity) {
    const alpha = new Uint8Array(width * height);
    let clear = 0;
    let painted = 0;
    for (let index = 0; index < alpha.length; index++) {
      alpha[index] = rgba[index * 4 + 3];
      if (alpha[index] < OCCLUDING_ALPHA * 255) clear += 1;
      if (alpha[index] > 0) painted += 1;
    }
    if (clear === 0) return { kind: "opaque" };
    if (painted === 0) return unreadVideoFrame("its frame read back fully transparent");
    return {
      kind: "matte",
      alpha,
      width,
      height,
      opacity,
      mapping: {
        ...mapping,
        sourceWidth: width,
        sourceHeight: height,
        scaleX: mapping.paintedWidth / width,
        scaleY: mapping.paintedHeight / height,
      },
    };
  }

  function matteOccludesAt(frame, x, y) {
    const pixel = sourcePixelAt(frame.mapping, x, y);
    if (!pixel) return false;
    return (frame.alpha[pixel.y * frame.width + pixel.x] / 255) * frame.opacity >= OCCLUDING_ALPHA;
  }

  // A video with an opaque CSS background paints that background behind its clear pixels.
  function matteFrameFor(element) {
    if (element.tagName !== "VIDEO") return null;
    if (hasOpaqueBackground(getComputedStyle(element))) return null;
    const frame = videoAlphaFrame(element);
    return frame.kind === "matte" ? frame : null;
  }

  // An element hides text beneath it when it paints opaque pixels at near-full
  // opacity: raster content (img/video/canvas), a background image, or a solid
  // background colour. Low-opacity overlays (grain, scrims) do not occlude.
  const canvasProbe = document.createElement("canvas");
  canvasProbe.width = 1;
  canvasProbe.height = 1;

  // The drawn alpha under the point, or null when the canvas cannot be read (then it counts as opaque).
  function canvasAlphaAt(element, x, y) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !element.width || !element.height) return null;
    const px = Math.min(
      element.width - 1,
      Math.max(0, Math.floor(((x - rect.left) / rect.width) * element.width)),
    );
    const py = Math.min(
      element.height - 1,
      Math.max(0, Math.floor(((y - rect.top) / rect.height) * element.height)),
    );
    try {
      const context = canvasProbe.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.clearRect(0, 0, 1, 1);
      context.drawImage(element, px, py, 1, 1, 0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] / 255;
    } catch {
      return null;
    }
  }

  function isOpaqueOccluder(element, x, y) {
    const opacity = opacityChain(element);
    if (opacity < OCCLUDING_ALPHA) return false;
    if (IGNORE_TAGS.has(element.tagName)) return false;
    if (element.tagName === "IMG") {
      const alpha = imageAlphaAt(element, x, y);
      if (alpha !== null) return alpha * opacity >= OCCLUDING_ALPHA;
    }
    if (element.tagName === "CANVAS") {
      const alpha = canvasAlphaAt(element, x, y);
      if (alpha !== null)
        return alpha * opacity >= OCCLUDING_ALPHA || hasOpaqueBackground(getComputedStyle(element));
    }
    const matte = matteFrameFor(element);
    if (matte) return matteOccludesAt(matte, x, y);
    if (RASTER_TAGS.has(element.tagName)) return true;
    return hasOpaqueBackground(getComputedStyle(element));
  }

  function hasAllowOcclusionFlag(element) {
    return element.hasAttribute("data-layout-allow-occlusion");
  }

  // A foreign element is one painted independently of the text — not the text
  // itself, its own subtree, or an ancestor it shares a background with.
  function isForeignElement(element, hit) {
    return !!hit && hit !== element && !element.contains(hit) && !hit.contains(element);
  }

  // During a scene-to-scene crossfade the incoming scene paints over the
  // outgoing scene's still-visible text at >= 0.6 opacity — and `--at-transitions`
  // samples exactly that midpoint. That overlap is the transition doing its job,
  // not an occlusion bug. Detect it: the occluder lives in a DIFFERENT composition
  // mount ([data-composition-id]) than the text, and at least one of the two scenes
  // is mid-fade (effective opacity < 1). Two fully-settled scenes overlapping
  // (both opacity 1) is NOT suppressed — that is a real layering bug.
  function isCrossSceneTransitionOverlap(textEl, occluder) {
    const textScene = textEl.closest("[data-composition-id]");
    const occluderScene = occluder.closest("[data-composition-id]");
    if (!textScene || !occluderScene || textScene === occluderScene) return false;
    return Math.min(opacityChain(textScene), opacityChain(occluderScene)) < 0.999;
  }

  // The nearest ancestor establishing a 3D rendering context, or null. Elements
  // sharing one are depth-sorted in 3D, so a "covering" hit is legitimate
  // perspective (e.g. the back face of a preserve-3d cube), not a 2D overlap.
  function preserve3dContext(element) {
    for (let current = element; current; current = current.parentElement) {
      const ts = getComputedStyle(current).transformStyle;
      if (ts === "preserve-3d") return current;
    }
    return null;
  }

  function sharedPreserve3d(a, b) {
    const ctx = preserve3dContext(a);
    return !!ctx && ctx === preserve3dContext(b);
  }

  // A covering element marked to cover text, or inside a marked wrapper that does not also hold the text.
  function allowsOcclusionOf(hit, element) {
    const allowed = authoredElement(hit).closest("[data-layout-allow-occlusion]");
    return !!allowed && !allowed.contains(element);
  }

  // The opaque element painted over (x, y), or null when the topmost element
  // there is related to the text, non-opaque, sharing a 3D context with it, or
  // part of a transient crossfade overlap.
  // fallow-ignore-next-line complexity
  function occluderAt(element, x, y, seenMattes) {
    // Walk the paint-ordered stack: a transparent layer on top must not mask an opaque one below it.
    const stack =
      typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(x, y)
        : typeof document.elementFromPoint === "function"
          ? [document.elementFromPoint(x, y)].filter(Boolean)
          : [];
    for (const hit of stack) {
      if (!isForeignElement(element, hit)) return null;
      // Pair-specific exemptions excuse this hit only; keep walking for deeper occluders.
      if (hasIgnoreFlag(hit) || allowsOcclusionOf(hit, element)) continue;
      if (sharedPreserve3d(element, hit)) continue;
      if (isCrossSceneTransitionOverlap(element, hit)) continue;
      const matte = seenMattes && matteFrameFor(hit);
      if (matte && !seenMattes.has(matte)) seenMattes.set(matte, hit);
      if (isOpaqueOccluder(hit, x, y)) return hit;
    }
    return null;
  }

  const OCCLUSION_PROBE_Y_FRACTIONS = [0.25, 0.5, 0.75];
  const OCCLUSION_PROBE_X_FRACTIONS = [0.03, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.97];
  const OCCLUSION_GRID_POINTS =
    OCCLUSION_PROBE_Y_FRACTIONS.length * OCCLUSION_PROBE_X_FRACTIONS.length;

  // Short, atomic text (a label/button/word, no whitespace) reads as a single
  // unit — ANY covered probe point changes what it says, so flag at any hit
  // (the pre-#U10 behaviour). Longer prose survives a nibbled edge; only flag
  // once a real share of it is covered — see `occludedTextIssue`.
  const ATOMIC_LABEL_MAX_CHARS = 16;
  // Default prose floor — callers may lower via auditLayout({ proseCoverageFloor }).
  const DEFAULT_PROSE_COVERAGE_FLOOR = 0.15;

  function isAtomicLabel(text) {
    return text.length > 0 && text.length <= ATOMIC_LABEL_MAX_CHARS && !/\s/.test(text);
  }

  // Sweep a grid across each painted text fragment (three rows, not just the
  // mid-line, so overlays covering only part of a multi-line block are caught).
  // Sampling fragments instead of their union avoids probing empty line gaps.
  // Unlike a
  // first-hit scan, this keeps sampling every point so it can report what
  // fraction of the box is actually covered — a corner nibble on a paragraph
  // reads very differently from a label buried under an overlay. Still
  // returns the first opaque element found, for `containerSelector`.
  function occlusionCoverage(element, textRects) {
    let occluder = null;
    let hits = 0;
    let opaqueHits = 0;
    // Every matte above the text, including where its alpha is clear: a feature narrower than the
    // probe grid (an arm, a mic stand) can hide a word between two probe columns.
    const seenMattes = new Map();
    for (const textRect of textRects) {
      for (const yFraction of OCCLUSION_PROBE_Y_FRACTIONS) {
        const y = textRect.top + textRect.height * yFraction;
        for (const xFraction of OCCLUSION_PROBE_X_FRACTIONS) {
          const x = textRect.left + textRect.width * xFraction;
          const hit = occluderAt(element, x, y, seenMattes);
          if (!hit) continue;
          hits += 1;
          if (!occluder) occluder = hit;
          if (!matteFrameFor(hit)) opaqueHits += 1;
        }
      }
    }
    const judgeByMatte = opaqueHits === 0 && seenMattes.size > 0;
    return {
      occluder: occluder || (judgeByMatte ? seenMattes.values().next().value : null),
      coveredFraction: round(hits / (OCCLUSION_GRID_POINTS * textRects.length)),
      mattes: judgeByMatte ? [...seenMattes.keys()] : [],
    };
  }

  // Thresholds from measuring rendered words against real subject mattes: a word reads as
  // deliberately tucked behind the subject at 30-55% covered, and is lost at 80%, or when it
  // and its neighbour are both half covered.
  const MATTE_WORD_LOST_COVERAGE = 0.8;
  const MATTE_PAIR_LOST_COVERAGE = 0.5;
  const MATTE_MAX_SAMPLES_PER_AXIS = 48;

  function wordClientRects(element) {
    const words = [];
    for (const node of directTextNodes(element)) {
      for (const match of (node.textContent || "").matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rects = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0.5 && rect.height > 0.5,
        );
        range.detach();
        if (rects.length > 0) words.push({ word: match[0], rects });
      }
    }
    return words;
  }

  function matteSampleCount(length, mattes) {
    const pitch = Math.max(1, Math.min(...mattes.map((matte) => matte.mapping.scaleX)));
    return Math.max(1, Math.min(MATTE_MAX_SAMPLES_PER_AXIS, Math.ceil(length / pitch)));
  }

  // Area-weighted share of the rects under any matte's occluding alpha, sampled at the matte's resolution.
  function matteCoverage(rects, mattes) {
    let coveredArea = 0;
    let totalArea = 0;
    for (const rect of rects) {
      const cols = matteSampleCount(rect.width, mattes);
      const rows = matteSampleCount(rect.height, mattes);
      let covered = 0;
      for (let row = 0; row < rows; row++) {
        const y = rect.top + ((row + 0.5) * rect.height) / rows;
        for (let col = 0; col < cols; col++) {
          const x = rect.left + ((col + 0.5) * rect.width) / cols;
          if (mattes.some((matte) => matteOccludesAt(matte, x, y))) covered += 1;
        }
      }
      const area = rect.width * rect.height;
      coveredArea += (area * covered) / (rows * cols);
      totalArea += area;
    }
    return totalArea > 0 ? round(coveredArea / totalArea) : 0;
  }

  function lostNeighbourPair(words) {
    for (let index = 1; index < words.length; index++) {
      const pair = [words[index - 1], words[index]];
      if (pair.every((word) => word.coverage >= MATTE_PAIR_LOST_COVERAGE)) return pair;
    }
    return null;
  }

  function percent(fraction) {
    return `${Math.round(fraction * 100)}%`;
  }

  function lostWordsMessage(lostWord, pair) {
    if (lostWord) {
      return `"${lostWord.word}" is ${percent(lostWord.coverage)} behind a transparent video's matte.`;
    }
    return `Neighbouring words "${pair[0].word}" and "${pair[1].word}" are ${percent(pair[0].coverage)} and ${percent(pair[1].coverage)} behind a transparent video's matte.`;
  }

  function markMatteWordsLost(issue, lostWord, pair) {
    issue.severity = "error";
    issue.message = lostWordsMessage(lostWord, pair);
    issue.fixHint =
      "Move or resize the text so no word is 80% behind the matte and no two neighbouring words are each half behind it, or mark intentional layering with data-layout-allow-occlusion.";
  }

  // Text behind a cutout is judged per rendered word against the decoded alpha: partial cover is
  // reported as info with its share, a lost word is an error.
  function matteOcclusionIssue(element, time, textRect, text, occluder, mattes) {
    const words = wordClientRects(element).map(({ word, rects }) => ({
      word,
      coverage: matteCoverage(rects, mattes),
    }));
    if (words.length === 0) return null;
    const peak = words.reduce((top, word) => (word.coverage > top.coverage ? word : top));
    if (peak.coverage <= 0) return null;
    const issue = {
      code: "text_occluded",
      severity: "info",
      time,
      selector: uniqueSelectorFor(element),
      containerSelector: uniqueSelectorFor(occluder),
      text,
      message: `Text sits partly behind a transparent video's matte; its most covered word "${peak.word}" is ${percent(peak.coverage)} hidden.`,
      rect: textRect,
      coveredFraction: peak.coverage,
    };
    const lostWord = peak.coverage >= MATTE_WORD_LOST_COVERAGE ? peak : null;
    const pair = lostNeighbourPair(words);
    if (lostWord || pair) markMatteWordsLost(issue, lostWord, pair);
    return { issue, first: words[0], last: words[words.length - 1] };
  }

  // Captions often render one word per element, so the neighbour rule also spans sibling elements.
  function markLostSiblingWords(matteResults) {
    for (const [element, result] of matteResults) {
      const next = element.nextElementSibling && matteResults.get(element.nextElementSibling);
      if (!next) continue;
      const pair = [result.last, next.first];
      if (!pair.every((word) => word.coverage >= MATTE_PAIR_LOST_COVERAGE)) continue;
      for (const { issue } of [result, next]) {
        if (issue.severity !== "error") markMatteWordsLost(issue, null, pair);
      }
    }
  }

  function unreadVideoIssues(time) {
    const issues = [];
    for (const [video, frame] of videoAlphaFrames) {
      if (frame.kind !== "unread") continue;
      issues.push({
        code: "video_alpha_unread",
        severity: "info",
        time,
        selector: uniqueSelectorFor(video),
        message: `Could not read this video's frame alpha (${frame.reason}), so text under it was judged as if the video were opaque.`,
        rect: toRect(video.getBoundingClientRect()),
      });
    }
    return issues;
  }

  // pointer-events:none hides elements from elementFromPoint — both probed text AND occluders.
  function restoreHitTesting(root) {
    const restores = [];
    for (const node of [root, ...root.querySelectorAll("*")]) {
      if (getComputedStyle(node).pointerEvents !== "none") continue;
      const previous = node.style.getPropertyValue("pointer-events");
      const priority = node.style.getPropertyPriority("pointer-events");
      node.style.setProperty("pointer-events", "auto", "important");
      restores.push(() => {
        if (previous) node.style.setProperty("pointer-events", previous, priority);
        else node.style.removeProperty("pointer-events");
      });
    }
    return () => restores.forEach((restore) => restore());
  }

  // No text ink is on screen while every non-whitespace text node sits at ~0 opacity (entrance not started).
  function hasVisibleTextInk(element) {
    const nodes = [element, ...element.querySelectorAll("*")];
    for (const node of nodes) {
      if (!directTextNodes(node).some((textNode) => textNode.textContent.trim())) continue;
      if (opacityChain(node) >= 0.05) return true;
    }
    return false;
  }

  // The global window [start, end) the element's own timed clip is on screen, or null when any timing
  // up the chain is not a plain number. Only composition hosts shift their children's clock.
  function clipLifetime(element) {
    const own = element.closest("[data-start]");
    if (!own) return null;
    const start = Number(own.getAttribute("data-start"));
    const duration = Number(own.getAttribute("data-duration"));
    if (!Number.isFinite(start) || !(duration > 0)) return null;
    let offset = 0;
    for (let host = own.parentElement; host; host = host.parentElement) {
      if (!host.hasAttribute("data-composition-id") || !host.hasAttribute("data-start")) continue;
      const hostStart = Number(host.getAttribute("data-start"));
      if (!Number.isFinite(hostStart)) return null;
      offset += hostStart;
    }
    return { start: start + offset, end: start + duration + offset };
  }

  // text_occluded: atomic labels flag at any hit; prose needs coveredFraction >= proseCoverageFloor (default 0.15).
  function occludedTextIssue(element, time, proseCoverageFloor, matteResults) {
    if (hasAllowOcclusionFlag(element)) return null;
    if (!hasVisibleTextInk(element)) return null;
    const textRect = textRectFor(element, true);
    if (!textRect) return null;
    const textRects = textClientRects(element, true);
    const text = textContentFor(element, true);
    const { occluder, coveredFraction, mattes } = occlusionCoverage(
      element,
      textRects.length > 0 ? textRects : [textRect],
    );
    if (!occluder) return null;
    if (mattes.length > 0) {
      const result = matteOcclusionIssue(element, time, textRect, text, occluder, mattes);
      if (result) matteResults.set(element, result);
      return result ? result.issue : null;
    }
    if (!isAtomicLabel(text) && coveredFraction < proseCoverageFloor) return null;
    return {
      code: "text_occluded",
      severity: "error",
      time,
      selector: uniqueSelectorFor(element),
      containerSelector: uniqueSelectorFor(occluder),
      text,
      message: "Text is hidden beneath an opaque element.",
      rect: textRect,
      coveredFraction,
      fixHint:
        "Give the text its own zone, raise its stacking order above the covering element, or mark intentional layering with data-layout-allow-occlusion.",
    };
  }

  // canvas_covered: an opaque element over most of the canvas with every other painted clip beneath it.
  const COVER_CANVAS_SHARE = 0.9;
  const COVERED_CONTENT_SHARE = 0.9;

  function paintsOwnContent(element) {
    return (
      hasOwnTextCandidate(element, true) ||
      FRAME_MEDIA_TAGS.has(element.tagName.toUpperCase()) ||
      hasPaint(getComputedStyle(element))
    );
  }

  function onCanvasRect(element, rootRect) {
    const rect = toRect(element.getBoundingClientRect());
    const left = Math.max(rect.left, rootRect.left);
    const top = Math.max(rect.top, rootRect.top);
    const right = Math.min(rect.right, rootRect.right);
    const bottom = Math.min(rect.bottom, rootRect.bottom);
    return right > left && bottom > top
      ? rectFromOrigin(left, top, right - left, bottom - top)
      : null;
  }

  // Topmost first, and a centre probe before the grid: a backdrop under its content clears on the first clip.
  function isBuried(element, rootRect) {
    const rect = onCanvasRect(element, rootRect);
    if (!rect) return true;
    if (!occluderAt(element, rect.left + rect.width / 2, rect.top + rect.height / 2)) return false;
    return occlusionCoverage(element, [rect]).coveredFraction >= COVERED_CONTENT_SHARE;
  }

  function spansCanvas(element, rootRect) {
    const rect = toRect(element.getBoundingClientRect());
    return intersectionArea(rect, rootRect) >= rectArea(rootRect) * COVER_CANVAS_SHARE;
  }

  function visibleElementsIn(root) {
    return Array.from(root.querySelectorAll("*")).filter((element) =>
      isVisibleElement(element, 0.05),
    );
  }

  // Only frame 0 asks: the craft sweep samples at 8 fps and the scan restores hit testing on every node.
  function canvasCoverAt(root, rootRect) {
    const restoreHits = restoreHitTesting(root);
    try {
      return canvasCoveredIssue(root, rootRect, visibleElementsIn(root), 0);
    } finally {
      restoreHits();
    }
  }

  function canvasCoveredIssue(root, rootRect, elements, time) {
    for (const cover of elements) {
      if (cover === root || hasAllowOcclusionFlag(cover) || !spansCanvas(cover, rootRect)) continue;
      // A buried backdrop is not a lost clip: full-frame b-roll over a background is the film.
      const beneath = elements.filter(
        (element) =>
          element !== cover &&
          !element.contains(cover) &&
          paintsOwnContent(element) &&
          !spansCanvas(element, rootRect),
      );
      if (
        beneath.length === 0 ||
        !beneath.reverse().every((element) => isBuried(element, rootRect))
      )
        continue;
      // Last: an opaque check reads a video's frame, which a backdrop under its content never needs.
      const matte = matteFrameFor(cover);
      if (matte && matteCoverage([rootRect], [matte]) < COVER_CANVAS_SHARE) continue;
      const rect = toRect(cover.getBoundingClientRect());
      if (!isOpaqueOccluder(cover, rect.left + rect.width / 2, rect.top + rect.height / 2))
        continue;
      return {
        code: "canvas_covered",
        severity: "error",
        time,
        selector: uniqueSelectorFor(cover),
        message:
          "An opaque element covers the canvas above every other visible clip, so the frame shows only it.",
        rect: toRect(cover.getBoundingClientRect()),
        fixHint:
          "Move the full-frame element below the content (earlier in the DOM or a lower z-index / track), or mark a deliberate full-frame card with data-layout-allow-occlusion.",
      };
    }
    return null;
  }

  function layoutOffset(element) {
    let left = 0;
    let top = 0;
    for (let current = element; current instanceof HTMLElement; current = current.offsetParent) {
      left += current.offsetLeft;
      top += current.offsetTop;
      if (current !== element) {
        left += current.clientLeft;
        top += current.clientTop;
      }
    }
    return { left, top };
  }

  function ancestorBackgroundPaintsText(element, textRect) {
    // Chromium 150+ includes independently painted descendants in text masks;
    // older builds drop their glyphs: https://github.com/heygen-com/hyperframes/issues/5117.
    const chromium = window.navigator.userAgent.match(/(?:HeadlessChrome|Chrome)\/(\d+)/);
    const chromiumVersion = chromium ? Number(chromium[1]) : 0;
    if (!chromiumVersion || !(element instanceof HTMLElement)) return false;

    for (
      let ancestor = element.parentElement;
      ancestor instanceof HTMLElement;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const clips = splitTopLevelCommas(
        style.webkitBackgroundClip || style.backgroundClip || "border-box",
      ).map((clip) => clip.trim());
      if (!clips.includes("text")) continue;
      if (chromiumVersion < 150 && hasIndependentTextPaint(element, ancestor)) continue;
      // Chromium builds the mask before descendant transforms, so moving the
      // child must not move its glyphs out of the mask for this check.
      const offset = layoutOffset(element);
      const parentOffset = layoutOffset(ancestor);
      const elementRect = element.getBoundingClientRect();
      const scaleX = elementRect.width > 0 ? element.offsetWidth / elementRect.width : 1;
      const scaleY = elementRect.height > 0 ? element.offsetHeight / elementRect.height : 1;
      const backgroundRect = rectFromOrigin(0, 0, ancestor.offsetWidth, ancestor.offsetHeight);
      const overlaps =
        element.offsetWidth > 0 && element.offsetHeight > 0
          ? textClientRects(element, true).some((rect) => {
              const layoutRect = rectFromOrigin(
                offset.left - parentOffset.left + (rect.left - elementRect.left) * scaleX,
                offset.top - parentOffset.top + (rect.top - elementRect.top) * scaleY,
                rect.width * scaleX,
                rect.height * scaleY,
              );
              return intersectionArea(layoutRect, backgroundRect) > 0;
            })
          : !overflowFor(textRect, ancestor.getBoundingClientRect(), 2);
      if (!overlaps) continue;

      const images = splitTopLevelCommas(style.backgroundImage || "none");
      const imagePaints = images.some(
        (image, index) =>
          clips[index % clips.length] === "text" &&
          (/url\(/i.test(image) ||
            (/(?:linear|radial|conic)-gradient\(/i.test(image) && gradientMaxAlpha(image) > 0.05)),
      );
      const colorPaints =
        clips[(images.length - 1) % clips.length] === "text" &&
        colorAlpha(style.backgroundColor || "rgba(0, 0, 0, 0)") > 0.05;
      if (imagePaints || colorPaints) return true;
    }
    return false;
  }

  // Plain descendants share a text mask on older Chromium; independently
  // painted descendants do not. Check the whole path to the mask, including
  // wrappers: https://github.com/chromium/chromium/blob/148.0.7778.97/third_party/blink/renderer/core/layout/layout_inline.cc.
  function hasIndependentTextPaint(element, background) {
    for (let current = element; current !== background; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.position && style.position !== "static") return true;
      if (Number.parseFloat(style.opacity || "1") < 1) return true;
      const isInline = style.display === "inline";
      if (
        [
          style.filter,
          style.backdropFilter,
          style.webkitBackdropFilter,
          style.maskImage,
          style.webkitMaskImage,
          style.clipPath,
          style.webkitClipPath,
          style.viewTransitionName,
        ].some((value) => value && value !== "none")
      )
        return true;
      if (
        !isInline &&
        [style.transform, style.translate, style.rotate, style.scale, style.perspective].some(
          (value) => value && value !== "none",
        )
      )
        return true;
      if (style.isolation === "isolate") return true;
      if (style.mixBlendMode && style.mixBlendMode !== "normal") return true;
      if (
        !isInline &&
        (style.backfaceVisibility === "hidden" || style.transformStyle === "preserve-3d")
      )
        return true;
      if (!isInline && /\b(?:paint|layout|content|strict)\b/.test(style.contain || "")) return true;
      if (style.contentVisibility && style.contentVisibility !== "visible") return true;
      if (
        (style.willChange || "")
          .split(",")
          .some(
            (property) =>
              /^(?:opacity|filter|backdrop-filter|position|isolation|mix-blend-mode|mask|mask-image|clip-path)$/.test(
                property.trim(),
              ) ||
              (!isInline &&
                /^(?:transform|translate|rotate|scale|perspective)$/.test(property.trim())),
          )
      )
        return true;
      if (style.zIndex && style.zIndex !== "auto" && current.parentElement) {
        const display = getComputedStyle(current.parentElement).display;
        if (/^(?:inline-)?(?:flex|grid)$/.test(display)) return true;
      }
    }
    return false;
  }

  // Text whose glyphs paint with an effectively transparent fill renders
  // invisibly even though the element, its box, opacity and color all read as
  // present — so geometry/occlusion/contrast audits miss it (contrast reads
  // `color`, not the fill that actually paints). `-webkit-text-fill-color`
  // overrides `color` for the glyph fill AND inherits, so a parent's
  // `transparent` fill silently blanks descendant text that has its own opaque
  // `color`. Its computed value already resolves to `color` when unset, so it
  // is the effective fill directly. Clipped text (`background-clip: text`)
  // legitimately uses a transparent fill — BUT only when a background actually
  // paints the glyphs; a `background-clip: text` with no gradient/image and no
  // opaque background-color paints nothing, so it stays reportable.
  function invisibleTextIssue(element, time) {
    const textRect = textRectFor(element, true);
    if (!textRect) return null;
    const text = textContentFor(element, true);
    if (!text) return null;
    const cs = getComputedStyle(element);
    // Vendor computed-style props are read by property (camelCase), matching
    // the rest of this script; `webkitTextFillColor` computes to `color` when
    // unset, so it is the effective fill directly.
    const fill = cs.webkitTextFillColor || cs.color;
    if (colorAlpha(fill) > 0.05) return null;
    if (
      Number.parseFloat(cs.webkitTextStrokeWidth) > 0 &&
      colorAlpha(cs.webkitTextStrokeColor) > 0.05
    )
      return null;
    const clip = cs.webkitBackgroundClip || cs.backgroundClip || "";
    if (/text/i.test(clip)) {
      const bgImage = cs.backgroundImage || "none";
      const paintsGlyphs =
        bgImage !== "none" || colorAlpha(cs.backgroundColor || "rgba(0, 0, 0, 0)") > 0.05;
      // A usable clipped background fills the glyphs — legitimate gradient/solid
      // clipped text. If nothing paints, fall through and report it.
      if (paintsGlyphs) return null;
    }
    if (ancestorBackgroundPaintsText(element, textRect)) return null;
    return {
      code: "text_not_painted",
      severity: "error",
      time,
      selector: uniqueSelectorFor(element),
      text,
      message:
        "Text paints with an effectively transparent fill (-webkit-text-fill-color / color), so its glyphs are invisible.",
      rect: textRect,
      fixHint:
        "Set an explicit, opaque `color` on the text — and an explicit `-webkit-text-fill-color` if an ancestor makes the fill transparent. If the transparency is intentional gradient text, add `background-clip: text`.",
    };
  }

  // Attachment allowance: callouts/tooltips legitimately hang near (not inside) their anchor.
  const ESCAPE_INTERSECTION_FRACTION = 0.3;
  const ESCAPE_MIN_CHILD_AREA = 2500;

  function edgeGap(child, parent) {
    const dx = Math.max(parent.left - child.right, 0, child.left - parent.right);
    const dy = Math.max(parent.top - child.bottom, 0, child.top - parent.bottom);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // An absolute element rendering far outside its offset parent was positioned in the wrong frame.
  function escapedContainerIssues(root, time) {
    const issues = [];
    const flagged = new Set();
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (!isVisibleElement(element) || hasAllowOverflowFlag(element)) continue;
      if (getComputedStyle(element).position !== "absolute") continue;
      const parent = element.offsetParent;
      if (!parent || parent === document.body || parent === root || !isVisibleElement(parent)) {
        continue;
      }
      const childRect = toRect(element.getBoundingClientRect());
      if (rectArea(childRect) < ESCAPE_MIN_CHILD_AREA) continue;
      const parentRect = toRect(parent.getBoundingClientRect());
      const visible = intersectionArea(childRect, parentRect);
      if (visible >= rectArea(childRect) * ESCAPE_INTERSECTION_FRACTION) continue;
      // Fully detached but hugging the parent = a callout/tooltip; touching yet mostly outside = drift.
      const allowance = Math.max(48, Math.min(childRect.width, childRect.height) / 2);
      if (visible <= 0 && edgeGap(childRect, parentRect) <= allowance) continue;
      flagged.add(element);
      issues.push({
        code: "escaped_container",
        severity: "warning",
        time,
        selector: uniqueSelectorFor(element),
        containerSelector: uniqueSelectorFor(parent),
        text: textContentFor(element),
        message:
          "Positioned element renders far outside its offset parent — its coordinates were likely computed in a different frame (canvas/viewport pixels).",
        rect: childRect,
        containerRect: parentRect,
        fixHint:
          "Compute left/top in the offset parent's frame (subtract its rect), or mark intentional placement with data-layout-allow-overflow.",
      });
    }
    return { issues, flagged };
  }

  // A gradient reads as content when any stop is solid; all-translucent stops are glows/vignettes.
  function gradientHasOpaqueStop(image) {
    const colors = image.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}|\btransparent\b/gi) || [];
    return colors.some((color) => !/^transparent$/i.test(color) && colorAlpha(color) >= 0.6);
  }

  function isPaintedPanel(element) {
    if (FRAME_MEDIA_TAGS.has(element.tagName.toUpperCase())) return false;
    const style = getComputedStyle(element);
    const image = style.backgroundImage || "none";
    if (image.includes("url(")) return true;
    if (image !== "none" && gradientHasOpaqueStop(image)) return true;
    if (!isTransparentColor(style.backgroundColor) && colorAlpha(style.backgroundColor) > 0.05) {
      return true;
    }
    return (
      parsePx(style.borderTopWidth) +
        parsePx(style.borderRightWidth) +
        parsePx(style.borderBottomWidth) +
        parsePx(style.borderLeftWidth) >
      0
    );
  }

  // Canvas-breach floor: entrance nudges stay quiet; matches the connector threshold scale.
  const PANEL_BREACH_FLOOR_PX = 24;
  const PANEL_BREACH_FLOOR_FRACTION = 0.025;
  // A hero-sized panel stuck on the edge is drift; a small painted bleed is usually decoration.
  const PANEL_HERO_AREA_FRACTION = 0.1;

  // Painted panels breaching the canvas: text is canvas_overflow's, media is frame_out_of_frame's, panels were nobody's.
  function panelOutOfCanvasIssues(root, rootRect, time, tolerance, escapedElements) {
    const issues = [];
    const floor = Math.max(
      PANEL_BREACH_FLOOR_PX,
      Math.min(rootRect.width, rootRect.height) * PANEL_BREACH_FLOOR_FRACTION,
    );
    const rootArea = rectArea(rootRect);
    const flagged = new Set();
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (!isVisibleElement(element) || hasAllowOverflowFlag(element)) continue;
      if (escapedElements.has(element)) continue;
      // Ownership is geometric and strict-mutex: any text breach past canvas_overflow's own
      // tolerance cedes the element to canvas_overflow; in-bounds text leaves the panel finding.
      if (hasOwnTextCandidate(element, true)) {
        const textRect = textRectFor(element, true);
        if (textRect && overflowFor(textRect, rootRect, tolerance)) continue;
      }
      const rect = toRect(element.getBoundingClientRect());
      if (rectArea(rect) >= rootArea * 0.95) continue;
      // Fully off-canvas paints nothing — that is a parked entrance, not drift.
      if (intersectionArea(rect, rootRect) <= 0) continue;
      const overflow = overflowFor(rect, rootRect, floor);
      if (!overflow || !isPaintedPanel(element)) continue;
      if (element.parentElement && flagged.has(element.parentElement)) {
        flagged.add(element);
        continue;
      }
      flagged.add(element);
      issues.push({
        code: "panel_out_of_canvas",
        severity: rectArea(rect) >= rootArea * PANEL_HERO_AREA_FRACTION ? "warning" : "info",
        time,
        selector: uniqueSelectorFor(element),
        containerSelector: uniqueSelectorFor(root),
        text: textContentFor(element).slice(0, 48),
        message: "Painted panel extends outside the composition canvas.",
        rect,
        containerRect: rootRect,
        overflow,
        fixHint:
          "Move the panel inward, or mark intentional off-canvas animation with data-layout-allow-overflow.",
      });
    }
    return issues;
  }

  // Pixels drawn into a <canvas> have no DOM box, so text the frame edge cuts is invisible to
  // canvas_overflow. Read a thin band just inside each covered frame edge and count sharp steps.
  const CANVAS_EDGE_STEP = 96;
  const CANVAS_EDGE_MIN_STEPS = 2;
  // Monospace and bitmap glyph cells end in a gap, so the outermost column alone can read empty.
  const CANVAS_EDGE_BAND_PX = 4;

  function coveredFrameEdges(rect, rootRect, tolerance) {
    const top = Math.max(rect.top, rootRect.top);
    const bottom = Math.min(rect.bottom, rootRect.bottom);
    const left = Math.max(rect.left, rootRect.left);
    const right = Math.min(rect.right, rootRect.right);
    if (bottom - top < CANVAS_EDGE_BAND_PX || right - left < CANVAS_EDGE_BAND_PX) return [];
    const band = CANVAS_EDGE_BAND_PX;
    const rows = { y: top, height: bottom - top, width: band, vertical: true };
    const cols = { x: left, width: right - left, height: band, vertical: false };
    const edges = [];
    if (rect.left <= rootRect.left + tolerance) edges.push({ side: "left", x: left, ...rows });
    if (rect.right >= rootRect.right - tolerance)
      edges.push({ side: "right", x: right - band, ...rows });
    if (rect.top <= rootRect.top + tolerance) edges.push({ side: "top", y: top, ...cols });
    if (rect.bottom >= rootRect.bottom - tolerance)
      edges.push({ side: "bottom", y: bottom - band, ...cols });
    return edges;
  }

  // Draw the band into a scratch canvas (never getContext on the film's own canvas, which would
  // claim it as 2D). A WebGL canvas without preserveDrawingBuffer reads blank: no finding.
  function canvasEdgeBand(canvas, rect, edge) {
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(edge.width * scaleX));
    off.height = Math.max(1, Math.round(edge.height * scaleY));
    const ctx = off.getContext("2d");
    if (!ctx) return null;
    const sx = Math.max(0, Math.floor((edge.x - rect.left) * scaleX));
    const sy = Math.max(0, Math.floor((edge.y - rect.top) * scaleY));
    ctx.drawImage(canvas, sx, sy, off.width, off.height, 0, 0, off.width, off.height);
    return {
      data: ctx.getImageData(0, 0, off.width, off.height).data,
      width: off.width,
      height: off.height,
    };
  }

  // Collapse the band across its thickness (brightest wins), then count steps along the edge:
  // luma over black plus alpha, compared two pixels back so anti-aliased glyph edges still step.
  function sharpSteps(band, vertical) {
    const length = vertical ? band.height : band.width;
    const thickness = vertical ? band.width : band.height;
    const levels = [];
    for (let along = 0; along < length; along++) {
      let luma = 0;
      let alpha = 0;
      for (let across = 0; across < thickness; across++) {
        const i = 4 * (vertical ? along * band.width + across : across * band.width + along);
        const a = band.data[i + 3];
        const l =
          (0.299 * band.data[i] + 0.587 * band.data[i + 1] + 0.114 * band.data[i + 2]) * (a / 255);
        luma = Math.max(luma, l);
        alpha = Math.max(alpha, a);
      }
      levels.push([luma, alpha]);
    }
    let steps = 0;
    for (let i = 2; i < levels.length; i++) {
      const [luma, alpha] = levels[i];
      const [backLuma, backAlpha] = levels[i - 2];
      if (Math.max(Math.abs(luma - backLuma), Math.abs(alpha - backAlpha)) < CANVAS_EDGE_STEP)
        continue;
      steps++;
      i += 2;
    }
    return steps;
  }

  function canvasEdgeHasContent(canvas, rect, edge) {
    try {
      const band = canvasEdgeBand(canvas, rect, edge);
      return !!band && sharpSteps(band, edge.vertical) >= CANVAS_EDGE_MIN_STEPS;
    } catch {
      return false;
    }
  }

  // ponytail: maps through the bounding box, exact for scale and translate; a rotated or skewed
  // canvas reads the wrong pixels. Add a matrix inverse if that bites.
  function canvasEdgeIssues(root, rootRect, time, tolerance) {
    const issues = [];
    for (const canvas of Array.from(root.querySelectorAll("canvas"))) {
      // A graded stand-in shows the author's media, not drawn art; the media itself is never read here.
      if (canvas.matches(GRADED_STAND_IN)) continue;
      if (!isVisibleElement(canvas) || hasAllowOverflowFlag(canvas)) continue;
      if (!canvas.width || !canvas.height) continue;
      const rect = toRect(canvas.getBoundingClientRect());
      if (!rect.width || !rect.height) continue;
      const sides = coveredFrameEdges(rect, rootRect, tolerance)
        .filter((edge) => canvasEdgeHasContent(canvas, rect, edge))
        .map((edge) => edge.side);
      if (sides.length === 0) continue;
      issues.push({
        code: "canvas_content_at_edge",
        severity: "warning",
        time,
        selector: uniqueSelectorFor(canvas),
        containerSelector: uniqueSelectorFor(root),
        message: `Canvas content touches the frame edge (${sides.join(", ")}).`,
        rect,
        containerRect: rootRect,
        fixHint:
          "Keep drawn text inside the visible part of the canvas, or mark intentional full-bleed art with data-layout-allow-overflow.",
      });
    }
    return issues;
  }

  // Soft prior only — the counterfactual attach test (below) is what makes detachment a finding.
  const CONNECTOR_NAME = /\b(conn(ector)?|arrow|edge|link|flow|wire)\b/i;
  const CONNECTOR_SKIP_CONTAINERS = "defs, marker, clipPath, mask, symbol, pattern";

  function connectorNameFor(element) {
    const className =
      typeof element.className === "string" ? element.className : element.className.baseVal || "";
    return `${element.id || ""} ${className}`;
  }

  function isConnectorPath(svg, path) {
    if (path.hasAttribute("marker-start") || path.hasAttribute("marker-end")) return true;
    return (
      CONNECTOR_NAME.test(connectorNameFor(svg)) || CONNECTOR_NAME.test(connectorNameFor(path))
    );
  }

  // Raw `d`-space endpoints (no CTM), as authors paste screen coords into `d`, plus the path length.
  function pathUserEndpoints(path) {
    if (typeof path.getTotalLength !== "function" || typeof path.getPointAtLength !== "function") {
      return null;
    }
    let total;
    try {
      total = path.getTotalLength();
    } catch {
      return null;
    }
    if (!Number.isFinite(total) || total <= 0) return null;
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(total);
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, total };
  }

  // Screen endpoints via getScreenCTM (viewBox, preserveAspectRatio, group transforms).
  function pathScreenEndpoints(svg, path, user) {
    if (
      !user ||
      typeof path.getScreenCTM !== "function" ||
      typeof svg.createSVGPoint !== "function"
    ) {
      return null;
    }
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    const toScreen = (local) => {
      const point = svg.createSVGPoint();
      point.x = local.x;
      point.y = local.y;
      const mapped = point.matrixTransform(matrix);
      return { x: mapped.x, y: mapped.y };
    };
    return { start: toScreen(user.start), end: toScreen(user.end) };
  }

  function distanceToRect(point, rect) {
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Solid, compact elements a connector could plausibly anchor to.
  // Both tiers keep `element` so attachment identity is stable across containment vs near-miss.
  function connectorAnchorRects(root, rootRect) {
    const compact = [];
    const painted = [];
    const rootArea = rectArea(rootRect);
    for (const element of Array.from(root.querySelectorAll("*"))) {
      // Known blind spot: anchors living inside an SVG (<image>, foreignObject) are not counted.
      if (element.closest("svg") || !isVisibleElement(element)) continue;
      const opaque =
        RASTER_TAGS.has(element.tagName) || hasOpaqueBackground(getComputedStyle(element));
      if (!opaque && !textContentFor(element)) continue;
      const rect = toRect(element.getBoundingClientRect());
      const area = rectArea(rect);
      if (area < 400) continue;
      // Containment tier: large opaque targets only — a text-bearing wrapper contains its own diagram's endpoints.
      if (opaque && area <= rootArea * 0.6) painted.push({ rect, element });
      if (area <= rootArea * 0.15) compact.push({ rect, element });
    }
    return { compact, painted };
  }

  // Attach near-miss tolerance (screen px) for both connector findings; not the glyph chord floor.
  function connectorAttachThreshold(rootRect) {
    return Math.max(32, Math.min(rootRect.width, rootRect.height) * 0.02);
  }

  // The one connector enumeration for connector_detached and connector_orphan. Skips dash-hidden
  // shafts; reports `painted` for callers to gate on, and `chord`, the rendered span in screen px.
  function* connectorShafts(root) {
    for (const svg of Array.from(root.querySelectorAll("svg"))) {
      if (!isVisibleElement(svg)) continue;
      for (const path of Array.from(svg.querySelectorAll("path"))) {
        if (path.closest(CONNECTOR_SKIP_CONTAINERS)) continue;
        if (!isConnectorPath(svg, path)) continue;
        const user = pathUserEndpoints(path);
        if (!user || shaftDashHidden(path, user.total)) continue;
        const rendered = pathScreenEndpoints(svg, path, user);
        if (!rendered) continue;
        const chord = Math.hypot(
          rendered.end.x - rendered.start.x,
          rendered.end.y - rendered.start.y,
        );
        yield { svg, path, user, rendered, chord, painted: shaftIsPainted(path) };
      }
    }
  }

  // Flag only the documented bug: rendered endpoints miss, but user-space-as-screen would attach.
  function connectorDetachmentIssues(root, rootRect, time) {
    const issues = [];
    let anchors = null;
    const threshold = connectorAttachThreshold(rootRect);
    const MIN_CONNECTOR_CHORD_PX = 8;
    for (const { svg, path, user, rendered, chord } of connectorShafts(root)) {
      if (chord < MIN_CONNECTOR_CHORD_PX) continue;
      if (anchors === null) anchors = connectorAnchorRects(root, rootRect);
      if (anchors.compact.length < 2) return issues;
      // Stable DOM identity across painted (inside) and compact (near-miss) tiers.
      const attachmentKey = (point) => {
        for (const anchor of anchors.painted) {
          if (!anchor.element.contains(svg) && distanceToRect(point, anchor.rect) === 0) {
            return anchor.element;
          }
        }
        for (const anchor of anchors.compact) {
          if (distanceToRect(point, anchor.rect) <= threshold) return anchor.element;
        }
        return null;
      };
      const attached = (point) => attachmentKey(point) !== null;
      // Half-attached as drawn is allowed; only full render-miss proceeds.
      if (attached(rendered.start) || attached(rendered.end)) continue;
      // Paste-into-`d` bug: both raw endpoints land on distinct anchors as screen pixels.
      const userStartKey = attachmentKey(user.start);
      const userEndKey = attachmentKey(user.end);
      const pasteBug = Boolean(userStartKey && userEndKey && userStartKey !== userEndKey);
      // Guessed marked shaft: both frames miss. Same-anchor grazes attach in user-space
      // and must stay skipped. Name-only decorative flow/arrow paths stay skipped.
      // 80px keeps short marker glyphs (chevrons, tips) out.
      const markedMiss =
        chord >= 80 &&
        !userStartKey &&
        !userEndKey &&
        (path.hasAttribute("marker-start") || path.hasAttribute("marker-end"));
      if (!pasteBug && !markedMiss) continue;
      const gap = Math.round(
        Math.min(
          Math.min(...anchors.compact.map((a) => distanceToRect(rendered.start, a.rect))),
          Math.min(...anchors.compact.map((a) => distanceToRect(rendered.end, a.rect))),
        ),
      );
      issues.push({
        code: "connector_detached",
        severity: "warning",
        time,
        selector: uniqueSelectorFor(path),
        containerSelector: uniqueSelectorFor(svg),
        message: pasteBug
          ? `Connector path endpoints render ${gap}px from the nearest anchorable element, but the path's user-space coordinates would attach if read as screen pixels — screen/viewport numbers were likely written into SVG \`d\` without inverting the CTM.`
          : `Connector path endpoints render ${gap}px from the nearest anchorable element — a marked shaft that meets no node.`,
        rect: toRect({
          left: Math.min(rendered.start.x, rendered.end.x),
          top: Math.min(rendered.start.y, rendered.end.y),
          right: Math.max(rendered.start.x, rendered.end.x),
          bottom: Math.max(rendered.start.y, rendered.end.y),
          width: Math.abs(rendered.end.x - rendered.start.x),
          height: Math.abs(rendered.end.y - rendered.start.y),
        }),
        fixHint: pasteBug
          ? "Convert measured screen coordinates into the SVG's user space (subtract the SVG rect / invert getScreenCTM) before writing path `d`, and keep the SVG a direct child of the stage."
          : "Measure the settled node boxes and write `d` in the SVG's user space (invert getScreenCTM), or grow a layout-owned shaft from the source node.",
      });
    }
    return issues;
  }

  function shaftIsPainted(path) {
    if (IGNORE_TAGS.has(path.tagName) || hasIgnoreFlag(path)) return false;
    const style = getComputedStyle(path);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }
    return opacityChain(path) >= 0.2;
  }

  // True when the visible dash window [offset, offset + length] sits in one gap (an unstarted
  // draw-on), allowing 10% overlap. Zero-length dashes paint only with a round or square linecap.
  // Distances are in `pathLength` units when set; a `pathLength` resolving to 0 paints solid.
  function shaftDashHidden(path, total) {
    const style = getComputedStyle(path);
    const dashes = dashArrayLengths(style.strokeDasharray, path);
    if (dashes === null) return false;
    const authored = path.pathLength?.baseVal; // SVGAnimatedNumber; 0 when unset or unparseable
    if (authored === 0 && path.hasAttribute("pathLength")) return false;
    const dotsPaint = (style.strokeLinecap || "butt") !== "butt";
    const dashPaints = (index) => index % 2 === 0 && (dashes[index] > 0 || dotsPaint);
    if (!dashes.some((_, index) => dashPaints(index))) return true; // only butt-capped dots
    const period = dashes.reduce((sum, dash) => sum + dash, 0);
    const length = authored > 0 ? authored : total;
    const offset = dashLength(style.strokeDashoffset, path); // unparseable reads as 0
    // Wrap into [0, period); adding the period only to negatives keeps `0.9 % 2` exact.
    const wrapped = Number.isFinite(offset) ? offset % period : 0;
    const start = wrapped < 0 ? wrapped + period : wrapped;
    const end = start + length;
    let painted = 0;
    let segmentStart = 0;
    // Two periods cover any window that starts inside the first.
    for (let i = 0; i < dashes.length * 2; i++) {
      const segmentEnd = segmentStart + dashes[i % dashes.length];
      if (dashPaints(i % dashes.length)) {
        if (segmentStart >= start && segmentEnd <= end) return false;
        painted += Math.max(0, Math.min(segmentEnd, end) - Math.max(segmentStart, start));
      }
      segmentStart = segmentEnd;
    }
    return painted <= length * 0.1;
  }

  // Computed `stroke-dasharray` as an even-length list of user-unit lengths, or null when the
  // stroke is solid: `none`, an all-zero list, or any negative/unparseable entry (which the spec
  // renders as `none`). Odd lists repeat, per spec.
  function dashArrayLengths(value, path) {
    const text = String(value || "none").trim();
    if (text === "none") return null;
    const lengths = text.split(/[\s,]+/).map((token) => dashLength(token, path));
    if (lengths.some((length) => !Number.isFinite(length) || length < 0)) return null;
    if (lengths.every((length) => length === 0)) return null;
    return lengths.length % 2 === 0 ? lengths : lengths.concat(lengths);
  }

  // One dash length in user units. Computed lengths are already px; a percentage is relative to
  // the normalised diagonal of the owning SVG viewport (viewBox when set, else the layout box).
  function dashLength(token, path) {
    const text = String(token).trim();
    const value = Number.parseFloat(text);
    if (!Number.isFinite(value) || !text.endsWith("%")) return value;
    const svg = path.ownerSVGElement;
    if (!svg) return NaN;
    const box = svg.viewBox && svg.viewBox.baseVal;
    const { width, height } =
      box && box.width > 0 && box.height > 0 ? box : svg.getBoundingClientRect();
    return (value / 100) * (Math.hypot(width, height) / Math.SQRT2);
  }

  function connectorEndpointCandidates(root, rootRect) {
    const candidates = [];
    const rootArea = rectArea(rootRect);
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.closest("svg") || IGNORE_TAGS.has(element.tagName) || hasIgnoreFlag(element))
        continue;
      const style = getComputedStyle(element);
      const opaque = RASTER_TAGS.has(element.tagName) || hasOpaqueBackground(style);
      if (!opaque && !textContentFor(element)) continue;
      const rect = toRect(element.getBoundingClientRect());
      const area = rectArea(rect);
      if (area < 400 || area > rootArea * 0.15) continue;
      candidates.push({ rect, element });
    }
    return candidates;
  }

  function connectorOrphanIssues(root, rootRect, time) {
    const issues = [];
    let candidates = null;
    const threshold = connectorAttachThreshold(rootRect);
    for (const { svg, path, rendered, chord, painted } of connectorShafts(root)) {
      if (!painted) continue;
      if (chord < 80) continue;
      if (candidates === null) candidates = connectorEndpointCandidates(root, rootRect);
      const dark = [];
      for (const point of [rendered.start, rendered.end]) {
        let best = null;
        let attached = false;
        for (const candidate of candidates) {
          const gap = distanceToRect(point, candidate.rect);
          if (gap > threshold) continue;
          if (isVisibleElement(candidate.element)) {
            attached = true;
            break;
          }
          if (best === null || gap < best.gap) best = { gap, candidate };
        }
        if (!attached && best !== null) dark.push(best.candidate);
      }
      if (dark.length === 0) continue;
      issues.push({
        code: "connector_orphan",
        severity: "warning",
        time,
        selector: uniqueSelectorFor(path),
        containerSelector: uniqueSelectorFor(svg),
        message: `Connector shaft is visible while ${dark.length === 2 ? "both endpoints are" : `its endpoint ${uniqueSelectorFor(dark[0].element)} is`} not on stage.`,
        rect: toRect({
          left: Math.min(rendered.start.x, rendered.end.x),
          top: Math.min(rendered.start.y, rendered.end.y),
          right: Math.max(rendered.start.x, rendered.end.x),
          bottom: Math.max(rendered.start.y, rendered.end.y),
          width: Math.abs(rendered.end.x - rendered.start.x),
          height: Math.abs(rendered.end.y - rendered.start.y),
        }),
        fixHint:
          "Show the shaft only after both ends are on, and hide it with the earlier exit. Do not give the line its own clock.",
      });
    }
    return issues;
  }

  function candidateAnchor(element) {
    const dataAttributes = {};
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("data-")) dataAttributes[attribute.name] = attribute.value;
    }
    const source = element
      .closest("[data-composition-file]")
      ?.getAttribute("data-composition-file");
    return {
      selector: uniqueSelectorFor(element),
      dataAttributes,
      sourceFile: source || "index.html",
    };
  }

  function geometryCandidate(element, kind, rect, elementRect, rootRect, tolerance) {
    const tag = element.tagName.toLowerCase();
    const text = kind === "text" ? textContentFor(element, true) : tag;
    const overflow = kind === "media" ? overflowFor(elementRect, rootRect, tolerance) : null;
    return {
      kind,
      tag,
      text,
      rect,
      elementRect,
      ...candidateAnchor(element),
      ...(overflow ? { overflow } : {}),
    };
  }

  window.__hyperframesGeometryCandidates = function collectGeometryCandidates(options) {
    const includeText = options?.text === true;
    const includeMedia = options?.media === true;
    if (!includeText && !includeMedia) return [];
    const tolerance = typeof options?.tolerance === "number" ? options.tolerance : 2;
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const rootRect = rootRectFor(root);
    const candidates = [];
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      if (element.closest('[data-composition-id="captions"], .caption-layer, #caption-stage')) {
        continue;
      }
      if (!isVisibleElement(element, 0.05, false)) continue;
      const elementRect = toRect(element.getBoundingClientRect());
      if (includeText && hasOwnTextCandidate(element, true) && !hasAllowCaptionZoneFlag(element)) {
        const rect = textRectFor(element, true);
        if (rect) {
          candidates.push(
            geometryCandidate(element, "text", rect, elementRect, rootRect, tolerance),
          );
        }
      }
      if (includeMedia && FRAME_MEDIA_TAGS.has(element.tagName.toUpperCase())) {
        candidates.push(
          geometryCandidate(element, "media", elementRect, elementRect, rootRect, tolerance),
        );
      }
    }
    return candidates;
  };

  window.__hyperframesLayoutAudit = function auditLayout(options) {
    const time = options && typeof options.time === "number" ? options.time : 0;
    const tolerance =
      options && typeof options.tolerance === "number" ? Math.max(0, options.tolerance) : 2;
    const proseCoverageFloor =
      options && typeof options.proseCoverageFloor === "number"
        ? Math.min(1, Math.max(0, options.proseCoverageFloor))
        : DEFAULT_PROSE_COVERAGE_FLOOR;
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const rootRect = rootRectFor(root);
    const elements = visibleElementsIn(root);
    const issues = [];
    const matteResults = new Map();
    videoAlphaFrames = new Map();

    const restoreHits = restoreHitTesting(root);
    try {
      for (const element of elements) {
        if (!hasOwnTextCandidate(element)) continue;
        const clipped = clippedTextIssue(element, time, tolerance);
        if (clipped) issues.push(clipped);
        issues.push(...textOverflowIssues(element, root, rootRect, time, tolerance, clipped));
        const occluded = occludedTextIssue(element, time, proseCoverageFloor, matteResults);
        if (occluded) {
          const lifetime = clipLifetime(element);
          if (lifetime) occluded.lifetime = lifetime;
          issues.push(occluded);
        }
        const invisible = invisibleTextIssue(element, time);
        if (invisible) issues.push(invisible);
      }
      const covered = canvasCoveredIssue(root, rootRect, elements, time);
      if (covered) issues.push(covered);
    } finally {
      restoreHits();
    }
    markLostSiblingWords(matteResults);
    issues.push(...unreadVideoIssues(time));

    issues.push(...containerOverflowIssues(root, time, tolerance));
    issues.push(...contentOverlapIssues(root, time));
    const escaped = escapedContainerIssues(root, time);
    issues.push(...escaped.issues);
    issues.push(...panelOutOfCanvasIssues(root, rootRect, time, tolerance, escaped.flagged));
    issues.push(...canvasEdgeIssues(root, rootRect, time, tolerance));
    issues.push(...connectorDetachmentIssues(root, rootRect, time));
    issues.push(...connectorOrphanIssues(root, rootRect, time));
    return issues;
  };

  // Reruns only the overlap detector (same threshold, no new surface) on a fine grid for the dense motion re-sampling pass.
  window.__hyperframesOverlapAudit = function auditOverlap(options) {
    const time = options && typeof options.time === "number" ? options.time : 0;
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    return contentOverlapIssues(root, time);
  };

  // Craft sampling for check's craft section (utils/craftAudit.ts judges it in Node). One call per seek:
  // every painted text element with its reading block, rendered font size and opacity; whether a data-hold
  // element is on screen; whether anything besides the background paints; and the keepsMoving liveness
  // signature from motion-signature.browser.js, so a still stretch here is the stillness motion_frozen sees.
  const craftKeys = new WeakMap();
  const craftAnchors = new WeakMap();
  let craftNextKey = 0;
  const INLINE_LEVEL_DISPLAY = /^(inline|inline-block|inline-flex|inline-grid|contents|ruby)$/;
  const CRAFT_PAINTED_OPACITY = 0.2;
  const PAINT_OPTIONS = { opacityProperty: true, visibilityProperty: true };

  function craftKey(element) {
    if (!craftKeys.has(element)) craftKeys.set(element, ++craftNextKey);
    return craftKeys.get(element);
  }

  // Sampled at every seek of a dense grid, so the selector walk runs once per element.
  function craftAnchor(element) {
    if (!craftAnchors.has(element)) {
      const source = element
        .closest("[data-composition-file]")
        ?.getAttribute("data-composition-file");
      craftAnchors.set(element, {
        selector: uniqueSelectorFor(element),
        sourceFile: source || "index.html",
      });
    }
    return craftAnchors.get(element);
  }

  // Mirrors trackKindOf in @hyperframes/parsers (data-track-kind, legacy caption hosts) plus the caption
  // stages __hyperframesGeometryCandidates already skips.
  function isCaptionsText(element) {
    for (let current = element; current; current = current.parentElement) {
      if ((current.getAttribute("data-track-kind") || "").trim().toLowerCase() === "captions") {
        return true;
      }
      const host =
        current.hasAttribute("data-composition-id") || current.hasAttribute("data-composition-src");
      if (!host) continue;
      if (current.getAttribute("data-composition-id") === "captions") return true;
      if (/(?:^|\s)caption[-_]/.test(current.getAttribute("class") || "")) return true;
    }
    return !!element.closest(".caption-layer, #caption-stage");
  }

  // The line a reader takes in at once: the nearest block-level ancestor-or-self, so a headline split into
  // inline word or character spans is one line, while flex items and positioned spans stay their own.
  function readingBlock(element, root) {
    let current = element;
    while (
      current !== root &&
      current.parentElement &&
      !current.hasAttribute("data-composition-id") &&
      INLINE_LEVEL_DISPLAY.test(getComputedStyle(current).display)
    ) {
      current = current.parentElement;
    }
    return current;
  }

  function scaleProperty(style) {
    const parts = (style.scale || "none")
      .split(/\s+/)
      .map((part) => Number.parseFloat(part))
      .filter(Number.isFinite);
    if (parts.length === 0) return 1;
    return Math.sqrt(Math.abs(parts[0] * (parts.length > 1 ? parts[1] : parts[0])));
  }

  // A transform scales glyphs without changing the computed font-size: multiply in every ancestor's area
  // scale (rotation-invariant), or the SVG screen matrix for SVG text.
  function renderedFontPx(element, style) {
    const font = parsePx(style.fontSize);
    if (typeof element.getScreenCTM === "function" && element.ownerSVGElement) {
      const ctm = element.getScreenCTM();
      return ctm ? font * Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) : font;
    }
    let scale = 1;
    for (let current = element; current; current = current.parentElement) {
      const currentStyle = current === element ? style : getComputedStyle(current);
      if (currentStyle.transform && currentStyle.transform !== "none") {
        try {
          const matrix = new DOMMatrixReadOnly(currentStyle.transform);
          scale *= Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
        } catch {
          // An unparsable transform leaves the size as computed.
        }
      }
      scale *= scaleProperty(currentStyle);
    }
    return font * scale;
  }

  function intersectsRect(rect, frame) {
    return (
      rect.right > frame.left &&
      rect.left < frame.right &&
      rect.bottom > frame.top &&
      rect.top < frame.bottom
    );
  }

  function craftTextParts(root, rootRect) {
    const candidates = [];
    for (const element of elementsOnScreenScenes(root)) {
      if (!hasOwnTextCandidate(element, true) || !isVisibleElement(element, 0.05, false)) continue;
      const rect = unionRects(visibleTextClientRects(element, true));
      if (!rect || !intersectsRect(rect, rootRect)) continue;
      candidates.push({ element, rect });
    }
    const clipped = candidates.filter((candidate) => hasClipPath(candidate.element));
    const clippedAway = new Set();
    if (clipped.length > 0) {
      const restoreHits = restoreHitTesting(root);
      try {
        for (const candidate of clipped) {
          if (isClippedAway(candidate.element)) clippedAway.add(candidate.element);
        }
      } finally {
        restoreHits();
      }
    }
    return candidates
      .filter((candidate) => !clippedAway.has(candidate.element))
      .map(({ element, rect }) => {
        const block = readingBlock(element, root);
        return {
          key: craftKey(element),
          block: craftKey(block),
          ...craftAnchor(element),
          blockSelector: craftAnchor(block).selector,
          text: textContentFor(element, true),
          opacity: round(opacityChain(element)),
          fontPx: round(renderedFontPx(element, getComputedStyle(element))),
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          captions: isCaptionsText(element),
        };
      });
  }

  function isPaintedBox(element, rootRect) {
    if (typeof element.checkVisibility === "function" && !element.checkVisibility(PAINT_OPTIONS)) {
      return false;
    }
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (opacityChain(element) < CRAFT_PAINTED_OPACITY) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4 && intersectsRect(rect, rootRect);
  }

  function paintsContent(root, rootRect, parts) {
    if (parts.some((part) => part.opacity >= CRAFT_PAINTED_OPACITY)) return true;
    for (const element of Array.from(root.querySelectorAll("img, video, canvas, svg"))) {
      if (element.parentElement?.closest("svg")) continue;
      if (isPaintedBox(element, rootRect)) return true;
    }
    return false;
  }

  window.__hyperframesCraftSample = function collectCraftSample(options) {
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const rootRect = rootRectFor(root);
    const parts = craftTextParts(root, rootRect);
    const cover = options && options.withCover ? canvasCoverAt(root, rootRect) : null;
    const holds = [root, ...Array.from(root.querySelectorAll("[data-hold]"))].filter((element) =>
      element.hasAttribute("data-hold"),
    );
    const shared = window.__hyperframesMotionSignature;
    return {
      parts,
      held: holds.some((element) => isPaintedBox(element, rootRect)),
      painted: paintsContent(root, rootRect, parts),
      coveredBy: cover ? cover.selector : null,
      signature: shared
        ? shared.compositionSignature(shared.compositionRoot(), { quantize: true })
        : "",
    };
  };

  // Sound the render mixes: any unmuted <audio>, and a <video> the timing compiler marks audible
  // (data-has-audio="true", or no data-has-audio on an unmuted video).
  window.__hyperframesCraftFilm = function collectCraftFilm() {
    let soundSources = 0;
    for (const media of Array.from(document.querySelectorAll("audio, video"))) {
      if (media.hasAttribute("muted")) continue;
      const declared = media.getAttribute("data-has-audio");
      const audible =
        media.tagName.toUpperCase() === "AUDIO" || declared === null || declared === "true";
      if (audible) soundSources += 1;
    }
    return { soundSources };
  };

  // The frozen-sweep fingerprint (window.__hyperframesLayoutGeometry, #U10 in
  // checkPipeline.ts) lives in motion-signature.browser.js, the single owner
  // of "what counts as motion" shared with motion-sample.browser.js's
  // liveness signature.

  // Rotation-pivot sampling (rotation_pivot_drift). Per sample, report every
  // rotatable candidate's bbox center, size, and current rotation angle. Node
  // accumulates these across the seek grid and, after the run, flags any
  // element that spins (angle varies) while its bbox CENTER drifts — the
  // signature of a wrong transformOrigin/svgOrigin (spokes swinging off-axis
  // instead of spinning in place). Single frame can't tell spin from pivot
  // drift, so this is a cross-sample finder, not a per-sample one.
  function rotationAngleDeg(transform) {
    if (!transform || transform === "none") return null;
    const match = transform.match(/matrix(3d)?\(([^)]+)\)/);
    if (!match) return null;
    const values = match[2].split(",").map((part) => Number.parseFloat(part));
    // matrix(a,b,c,d,e,f) → a=values[0], b=values[1]. matrix3d shares the same
    // leading two entries for the in-plane 2D rotation component.
    const a = values[0];
    const b = values[1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return (Math.atan2(b, a) * 180) / Math.PI;
  }

  window.__hyperframesRotationSample = function collectRotationSample() {
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const samples = [];
    // Cap the candidate set so a pathological composition can't blow up the
    // per-sample payload; transformed elements above a minimum area only.
    const CANDIDATE_CAP = 200;
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (samples.length >= CANDIDATE_CAP) break;
      // Intended orbits/satellites opt out — their bbox center is SUPPOSED to
      // travel, so a drift finding there is a false positive.
      if (element.closest("[data-layout-allow-orbit]")) continue;
      if (!isVisibleElement(element, 0.05)) continue;
      const angle = rotationAngleDeg(getComputedStyle(element).transform);
      if (angle === null) continue; // identity / untransformed — not a candidate
      const box = element.getBoundingClientRect();
      if (box.width * box.height <= 400) continue;
      samples.push({
        selector: uniqueSelectorFor(element),
        cx: round(box.left + box.width / 2),
        cy: round(box.top + box.height / 2),
        w: round(box.width),
        h: round(box.height),
        angle: round(angle),
      });
    }
    return samples;
  };

  // Needle-pivot sampling (off_pivot_rotation). A gauge/clock/radar pointer
  // whose center-of-rotation sits far from the dial hub. bbox-intrinsic measures
  // can't tell a correct sweep from a broken one (a base-pivoted needle's bbox
  // center orbits either way), so this records two MATERIAL points on each
  // elongated rotating SVG figure — mapped through getScreenCTM so the actual
  // rendered transform is honored regardless of svgOrigin/transform-origin — and
  // the dial's static hub (the point shared by the most non-rotating circles).
  // The pipeline fits a rotation to the material-point trajectories to recover
  // the real center-of-rotation and flags it when it drifts off that hub.
  function ctmRotationDeg(ctm) {
    if (!ctm) return null;
    return (Math.atan2(ctm.b, ctm.a) * 180) / Math.PI;
  }

  function ctmScale(ctm) {
    return Math.hypot(ctm.a, ctm.b);
  }

  function mapPoint(svg, ctm, x, y) {
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const mapped = point.matrixTransform(ctm);
    return { x: mapped.x, y: mapped.y };
  }

  // Walks up to (and including) the composition root, NOT just the owner <svg>:
  // an element spun by a div ancestor above its svg must not be mistaken for a
  // static hub anchor (else a lone rotating arc becomes its own dial center).
  function hasRotatedAncestor(element, root) {
    let node = element;
    while (node) {
      const angle = rotationAngleDeg(getComputedStyle(node).transform);
      if (angle !== null && Math.abs(angle) > 1) return true;
      if (node === root) break;
      node = node.parentElement;
    }
    return false;
  }

  // KEEP IN SYNC with `fitCircle` in packages/cli/src/utils/checkPipeline.ts —
  // this browser copy resolves arc-drawn dial hubs and is injected as a raw
  // string (no import across the puppeteer boundary), so the Kåsa math is
  // intentionally duplicated per-language. Any change must land in both copies.
  function fitCirclePoints(points) {
    const count = points.length;
    if (count < 3) return null;
    const meanX = points.reduce((sum, p) => sum + p.x, 0) / count;
    const meanY = points.reduce((sum, p) => sum + p.y, 0) / count;
    let suu = 0,
      svv = 0,
      suv = 0,
      suuu = 0,
      svvv = 0,
      suvv = 0,
      svuu = 0;
    for (const point of points) {
      const u = point.x - meanX;
      const v = point.y - meanY;
      suu += u * u;
      svv += v * v;
      suv += u * v;
      suuu += u * u * u;
      svvv += v * v * v;
      suvv += u * v * v;
      svuu += v * u * u;
    }
    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-6) return null;
    const uc = (((suuu + suvv) / 2) * svv - ((svvv + svuu) / 2) * suv) / det;
    const vc = (((svvv + svuu) / 2) * suu - ((suuu + suvv) / 2) * suv) / det;
    const cx = uc + meanX;
    const cy = vc + meanY;
    const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / count);
    let squaredError = 0;
    for (const point of points) {
      const delta = Math.hypot(point.x - cx, point.y - cy) - radius;
      squaredError += delta * delta;
    }
    return { cx, cy, radius, residual: Math.sqrt(squaredError / count) };
  }

  // Fallback for dials drawn as arc <path> rather than <circle> rings: sample
  // the largest static, near-circular path and recover its arc center.
  function arcHubForSvg(svg, root) {
    let best = null;
    for (const path of Array.from(svg.querySelectorAll("path"))) {
      if (hasRotatedAncestor(path, root)) continue;
      if (typeof path.getTotalLength !== "function") continue;
      const total = path.getTotalLength();
      if (total < 200) continue;
      const ctm = path.getScreenCTM();
      if (!ctm) continue;
      const points = [];
      for (let i = 0; i <= 16; i++) {
        const local = path.getPointAtLength((total * i) / 16);
        points.push(mapPoint(svg, ctm, local.x, local.y));
      }
      const fit = fitCirclePoints(points);
      if (!fit || fit.radius < 40) continue;
      if (fit.residual > 0.05 * fit.radius) continue;
      if (!best || fit.radius > best.radius) best = fit;
    }
    return best ? { hx: best.cx, hy: best.cy, hr: best.radius, count: 2 } : null;
  }

  function dialHubForSvg(svg, root) {
    const centers = [];
    for (const circle of Array.from(svg.querySelectorAll("circle"))) {
      if (hasRotatedAncestor(circle, root)) continue;
      const ctm = circle.getScreenCTM();
      if (!ctm) continue;
      const cx = Number.parseFloat(circle.getAttribute("cx") || "0");
      const cy = Number.parseFloat(circle.getAttribute("cy") || "0");
      const center = mapPoint(svg, ctm, cx, cy);
      const radius = Number.parseFloat(circle.getAttribute("r") || "0") * ctmScale(ctm);
      centers.push({ x: center.x, y: center.y, radius });
    }
    let best = null;
    for (const anchor of centers) {
      const cluster = centers.filter(
        (other) => Math.hypot(other.x - anchor.x, other.y - anchor.y) <= 8,
      );
      if (!best || cluster.length > best.cluster.length) best = { anchor, cluster };
    }
    if (best && best.cluster.length >= 2) {
      const count = best.cluster.length;
      const hx = best.cluster.reduce((sum, item) => sum + item.x, 0) / count;
      const hy = best.cluster.reduce((sum, item) => sum + item.y, 0) / count;
      const hr = best.cluster.reduce((max, item) => Math.max(max, item.radius), 0);
      return { hx, hy, hr, count };
    }
    return arcHubForSvg(svg, root);
  }

  window.__hyperframesOffPivotRotationSample = function collectOffPivotRotationSample() {
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const samples = [];
    const hubCache = new Map();
    const CANDIDATE_CAP = 60;
    for (const element of Array.from(
      root.querySelectorAll("path, polygon, line, rect, polyline, g"),
    )) {
      if (samples.length >= CANDIDATE_CAP) break;
      const svg = element.ownerSVGElement;
      if (!svg || typeof element.getBBox !== "function") continue;
      if (element.closest("[data-layout-allow-orbit]")) continue;
      if (!isVisibleElement(element, 0.05)) continue;
      const ctm = element.getScreenCTM();
      const angle = ctmRotationDeg(ctm);
      if (ctm === null || angle === null) continue;
      let bbox;
      try {
        bbox = element.getBBox();
      } catch {
        continue;
      }
      const long = Math.max(bbox.width, bbox.height);
      const short = Math.min(bbox.width, bbox.height);
      if (short <= 0 || long / short < 3 || long < 40) continue;
      const vertical = bbox.height >= bbox.width;
      const midMajor = vertical ? bbox.x + bbox.width / 2 : bbox.y + bbox.height / 2;
      const a = vertical
        ? mapPoint(svg, ctm, midMajor, bbox.y)
        : mapPoint(svg, ctm, bbox.x, midMajor);
      const b = vertical
        ? mapPoint(svg, ctm, midMajor, bbox.y + bbox.height)
        : mapPoint(svg, ctm, bbox.x + bbox.width, midMajor);
      let hub = hubCache.get(svg);
      if (hub === undefined) {
        hub = dialHubForSvg(svg, root);
        hubCache.set(svg, hub);
      }
      samples.push({
        selector: uniqueSelectorFor(element),
        ax: round(a.x),
        ay: round(a.y),
        bx: round(b.x),
        by: round(b.y),
        len: round(Math.hypot(b.x - a.x, b.y - a.y)),
        angle: round(angle),
        hx: hub ? round(hub.hx) : null,
        hy: hub ? round(hub.hy) : null,
        hr: hub ? round(hub.hr) : null,
        hubCount: hub ? hub.count : 0,
      });
    }
    return samples;
  };
})();
