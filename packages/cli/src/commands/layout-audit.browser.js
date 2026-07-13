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
    if (
      opacityFloor != null &&
      typeof element.checkVisibility === "function" &&
      !element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      })
    ) {
      return false;
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
    for (const child of Array.from(element.children)) {
      if (isVisibleElement(child) && textContentFor(child)) return false;
    }
    return true;
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

  function textRectFor(element, directOnly) {
    const rects = textClientRects(element, directOnly);
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

  // An ancestor (up to and including `stopAt`) that clips its overflow makes any
  // text spilling past it invisible — that clipping IS the layout mechanism
  // (odometer/ticker reels, masked windows), not a defect to report.
  function clippedByAncestor(element, stopAt) {
    for (let current = element; current; current = current.parentElement) {
      if (current !== element && clipsOverflow(getComputedStyle(current))) return true;
      if (current === stopAt) break;
    }
    return false;
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
    if (
      containerOverflow &&
      !hasAllowOverflowFlag(element) &&
      !clippedByAncestor(element, container)
    ) {
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
    const area = intersectionArea(a.rect, b.rect);
    if (area <= Math.min(rectArea(a.rect), rectArea(b.rect)) * 0.2) return null;
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
    let imageAlpha = 0;
    if (style.backgroundImage && style.backgroundImage !== "none") {
      if (style.backgroundImage.includes("url(")) return true;
      // A gradient only occludes as much as its colours — a 4%-alpha grid/scrim must not count.
      imageAlpha = gradientLayersAlpha(style.backgroundImage);
    }
    const colorValue = isTransparentColor(style.backgroundColor)
      ? 0
      : colorAlpha(style.backgroundColor);
    // Layers composite: a 0.5 gradient over a 0.5 background colour paints at ~0.75.
    return 1 - (1 - imageAlpha) * (1 - colorValue) > 0.6;
  }

  // background-image layers stack: two 0.5-alpha gradients paint at 1-(1-.5)^2 = .75.
  function gradientLayersAlpha(backgroundImage) {
    let combined = 0;
    for (const layer of splitTopLevelCommas(backgroundImage)) {
      combined = 1 - (1 - combined) * (1 - gradientMaxAlpha(layer));
    }
    return combined;
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

  const RASTER_TAGS = new Set(["IMG", "VIDEO", "CANVAS"]);
  const FRAME_MEDIA_TAGS = new Set([...RASTER_TAGS, "SVG"]);

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

  // The opaque element painted over (x, y), or null when the topmost element
  // there is related to the text, non-opaque, sharing a 3D context with it, or
  // part of a transient crossfade overlap.
  // fallow-ignore-next-line complexity
  function occluderAt(element, x, y) {
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
      if (sharedPreserve3d(element, hit)) continue;
      if (isCrossSceneTransitionOverlap(element, hit)) continue;
      if (isOpaqueOccluder(hit)) return hit;
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
  const PROSE_COVERAGE_FLOOR = 0.15;

  function isAtomicLabel(text) {
    return text.length > 0 && text.length <= ATOMIC_LABEL_MAX_CHARS && !/\s/.test(text);
  }

  // Sweep a grid across the text box (three rows, not just the mid-line, so
  // overlays covering only part of a multi-line block are caught). Unlike a
  // first-hit scan, this keeps sampling every point so it can report what
  // fraction of the box is actually covered — a corner nibble on a paragraph
  // reads very differently from a label buried under an overlay. Still
  // returns the first opaque element found, for `containerSelector`.
  function occlusionCoverage(element, textRect) {
    let occluder = null;
    let hits = 0;
    for (const yFraction of OCCLUSION_PROBE_Y_FRACTIONS) {
      const y = textRect.top + textRect.height * yFraction;
      for (const xFraction of OCCLUSION_PROBE_X_FRACTIONS) {
        const hit = occluderAt(element, textRect.left + textRect.width * xFraction, y);
        if (!hit) continue;
        hits += 1;
        if (!occluder) occluder = hit;
      }
    }
    return { occluder, coveredFraction: round(hits / OCCLUSION_GRID_POINTS) };
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

  // Catches the blind spot the overflow checks miss: text that fits its box
  // perfectly but is covered by a later sibling/overlay. An atomic label
  // (short, no whitespace) flags at any coverage; ordinary prose only flags
  // once coveredFraction clears PROSE_COVERAGE_FLOOR, since a sliver of edge
  // cover on a paragraph is usually a styling artifact, not a reading defect.
  function occludedTextIssue(element, time) {
    if (hasAllowOcclusionFlag(element)) return null;
    if (!hasVisibleTextInk(element)) return null;
    const textRect = textRectFor(element);
    if (!textRect) return null;
    const text = textContentFor(element);
    const { occluder, coveredFraction } = occlusionCoverage(element, textRect);
    if (!occluder) return null;
    if (!isAtomicLabel(text) && coveredFraction < PROSE_COVERAGE_FLOOR) return null;
    return {
      code: "text_occluded",
      severity: "error",
      time,
      selector: selectorFor(element),
      containerSelector: selectorFor(occluder),
      text,
      message: "Text is hidden beneath an opaque element.",
      rect: textRect,
      coveredFraction,
      fixHint:
        "Give the text its own zone, raise its stacking order above the covering element, or mark intentional layering with data-layout-allow-occlusion.",
    };
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
    const textRect = textRectFor(element);
    if (!textRect) return null;
    const text = textContentFor(element);
    if (!text) return null;
    const cs = getComputedStyle(element);
    // Vendor computed-style props are read by property (camelCase), matching
    // the rest of this script; `webkitTextFillColor` computes to `color` when
    // unset, so it is the effective fill directly.
    const fill = cs.webkitTextFillColor || cs.color;
    if (colorAlpha(fill) > 0.05) return null;
    const clip = cs.webkitBackgroundClip || cs.backgroundClip || "";
    if (/text/i.test(clip)) {
      const bgImage = cs.backgroundImage || "none";
      const paintsGlyphs =
        bgImage !== "none" || colorAlpha(cs.backgroundColor || "rgba(0, 0, 0, 0)") > 0.05;
      // A usable clipped background fills the glyphs — legitimate gradient/solid
      // clipped text. If nothing paints, fall through and report it.
      if (paintsGlyphs) return null;
    }
    return {
      code: "text_not_painted",
      severity: "error",
      time,
      selector: selectorFor(element),
      text,
      message:
        "Text paints with an effectively transparent fill (-webkit-text-fill-color / color), so its glyphs are invisible.",
      rect: textRect,
      fixHint:
        "Set an explicit, opaque `color` on the text — and an explicit `-webkit-text-fill-color` if an ancestor makes the fill transparent. If the transparency is intentional gradient text, add `background-clip: text`.",
    };
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
      if (includeText && hasOwnTextCandidate(element, true)) {
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
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const rootRect = rootRectFor(root);
    const elements = Array.from(root.querySelectorAll("*")).filter((element) =>
      isVisibleElement(element),
    );
    const issues = [];

    const restoreHits = restoreHitTesting(root);
    try {
      for (const element of elements) {
        if (!hasOwnTextCandidate(element)) continue;
        const clipped = clippedTextIssue(element, time, tolerance);
        if (clipped) issues.push(clipped);
        issues.push(...textOverflowIssues(element, root, rootRect, time, tolerance));
        const occluded = occludedTextIssue(element, time);
        if (occluded) issues.push(occluded);
        const invisible = invisibleTextIssue(element, time);
        if (invisible) issues.push(invisible);
      }
    } finally {
      restoreHits();
    }

    issues.push(...containerOverflowIssues(root, time, tolerance));
    issues.push(...contentOverlapIssues(root, time));
    return issues;
  };

  // Frozen-sweep guard (#U10, checkPipeline.ts): a compact per-sample
  // fingerprint of every visible element's box + opacity, in DOM order. Node
  // calls this once per seeked grid point and compares the strings across the
  // whole run — if every sample produces the identical string, the seek never
  // actually moved anything and the whole audit run is unreliable. Deliberately
  // a single opaque string (not a structured array) since Node only ever needs
  // equality, not per-element diffing.
  // Pixel-only media motion (a 2D/WebGL canvas repainting or a playing video
  // without any element moving) is invisible to a geometry+opacity fingerprint
  // and false-positives sweep_static. Downsample each visible canvas/video to
  // 8x8 and fold its pixels into the fingerprint. Tainted, zero-sized, or
  // unreadable media hashes to a constant — no worse than geometry-only
  // detection and never a new false negative for DOM-motion compositions.
  // Media inside iframes is intentionally outside this fingerprint: it lives
  // in a separate document, and cross-origin frames are inaccessible under SOP.
  function mediaPixelHash(element) {
    try {
      const rect = element.getBoundingClientRect();
      const sourceWidth = element.videoWidth || element.width || rect.width;
      const sourceHeight = element.videoHeight || element.height || rect.height;
      if (!sourceWidth || !sourceHeight) return "x";
      const off = document.createElement("canvas");
      off.width = 8;
      off.height = 8;
      const ctx = off.getContext("2d");
      if (!ctx) return "x";
      ctx.drawImage(element, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let hash = 0;
      for (let i = 0; i < data.length; i++) hash = (hash * 31 + data[i]) >>> 0;
      return String(hash);
    } catch {
      return "x";
    }
  }

  window.__hyperframesLayoutGeometry = function collectLayoutGeometry() {
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body;
    const elements = Array.from(root.querySelectorAll("*")).filter((element) =>
      isVisibleElement(element),
    );
    const parts = elements.map((element) => {
      const rect = toRect(element.getBoundingClientRect());
      const opacity = round(opacityChain(element));
      return `${rect.left},${rect.top},${rect.width},${rect.height},${opacity}`;
    });
    for (const media of root.querySelectorAll("canvas, video")) {
      if (!isVisibleElement(media)) continue;
      parts.push(`p:${mediaPixelHash(media)}`);
    }
    return parts.join("|");
  };
})();
