import { createHash } from "node:crypto";
import type { Page } from "puppeteer";
import type { SemanticFixtureState, SemanticStateFixtureSpec } from "./semantic-fixtures.js";
import type {
  PresentationSnapshot,
  RectSnapshot,
  SemanticSnapshot,
  SemanticStateSnapshot,
  TargetSnapshot,
  ThemeLayoutNode,
  TimelineSnapshot,
} from "./verify.js";

declare global {
  interface Window {
    axe: {
      run: (
        context: Document,
        options: { resultTypes: string[] },
      ) => Promise<{
        violations: Array<{
          id: string;
          impact: string | null;
          nodes: Array<{ target: string[] }>;
        }>;
      }>;
    };
    __timelines?: Record<
      string,
      {
        labels: Record<string, number>;
        duration: () => number;
        pause: () => unknown;
        seek: (position: string | number, suppressEvents?: boolean) => unknown;
        time: (position: number, suppressEvents?: boolean) => unknown;
      }
    >;
  }
}

export interface CanonicalBrowserEvidence {
  presentation: PresentationSnapshot;
  targets: TargetSnapshot[];
  semantics: SemanticSnapshot;
  coarsePointer: boolean;
}

export interface CanonicalEvidenceOptions {
  runAxe?: boolean;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadFixture(page: Page, html: string): Promise<void> {
  await page.goto("about:blank");
  await page.setContent(html, { waitUntil: "load" });
  await page.addScriptTag({
    content: `
      globalThis.__name ||= (target, value) => {
        Object.defineProperty(target, "name", { value, configurable: true });
        return target;
      };
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map(async (image) => {
        if (image.complete) return;
        try {
          await image.decode();
        } catch {
          // The runtime/network audit reports unavailable assets separately.
        }
      }),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

export async function injectAxe(page: Page, axeSource: string): Promise<void> {
  await page.addScriptTag({ content: axeSource });
}

export async function screenshotHash(page: Page): Promise<string> {
  const bytes = await page.screenshot({ type: "png", captureBeyondViewport: false });
  return hashBytes(bytes);
}

export async function elementScreenshotHash(page: Page, selector: string): Promise<string> {
  const element = await page.$(selector);
  if (element === null) throw new Error(`missing screenshot target ${selector}`);
  const bytes = await element.screenshot({ type: "png" });
  return hashBytes(bytes);
}

export async function collectThemeLayout(page: Page): Promise<ThemeLayoutNode[]> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-hf-ui-root]");
    if (root === null) throw new Error("layout fixture has no [data-hf-ui-root]");
    const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
    const pathFor = (element: HTMLElement): string => {
      if (element === root) return "root";
      const parts: number[] = [];
      let current: HTMLElement | null = element;
      while (current !== null && current !== root) {
        const parent: HTMLElement | null = current.parentElement;
        if (parent === null) break;
        parts.push(Array.from(parent.children).indexOf(current));
        current = parent;
      }
      return `root>${parts.toReversed().join(">")}`;
    };
    const rounded = (value: number): number => Math.round(value * 100) / 100;
    return nodes.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        path: pathFor(element),
        values: [
          element.localName,
          rounded(rect.x),
          rounded(rect.y),
          rounded(rect.width),
          rounded(rect.height),
          element.clientWidth,
          element.clientHeight,
          element.scrollWidth,
          element.scrollHeight,
          style.display,
          style.position,
          style.boxSizing,
          style.overflowX,
          style.overflowY,
          style.flexDirection,
          style.flexWrap,
          style.alignItems,
          style.justifyContent,
          style.gridTemplateColumns,
          style.gridTemplateRows,
          style.gap,
          style.paddingTop,
          style.paddingRight,
          style.paddingBottom,
          style.paddingLeft,
          style.marginTop,
          style.marginRight,
          style.marginBottom,
          style.marginLeft,
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          style.lineHeight,
          style.letterSpacing,
          style.textAlign,
          style.whiteSpace,
          style.transform,
          style.transformOrigin,
          style.opacity,
        ],
      };
    });
  });
}

export async function collectCanonicalEvidence(
  page: Page,
  focusTarget: string,
  options: CanonicalEvidenceOptions = {},
): Promise<CanonicalBrowserEvidence> {
  return page.evaluate(
    async ({ inventoryFocusTarget, runAxe }) => {
      const root = document.querySelector<HTMLElement>("[data-hf-ui-root]");
      if (root === null) throw new Error("canonical fixture has no [data-hf-ui-root]");

      const rectSnapshot = (rect: DOMRect): RectSnapshot => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const classNames = Array.from(element.classList).slice(0, 2);
        if (classNames.length > 0) {
          return `${element.localName}.${classNames.map((name) => CSS.escape(name)).join(".")}`;
        }
        const parent = element.parentElement;
        if (parent === null) return element.localName;
        const siblings = Array.from(parent.children).filter(
          (candidate) => candidate.localName === element.localName,
        );
        return siblings.length <= 1
          ? element.localName
          : `${element.localName}:nth-of-type(${siblings.indexOf(element) + 1})`;
      };
      const cumulativeOpacity = (element: Element): number => {
        let opacity = 1;
        let current: Element | null = element;
        while (current !== null) {
          opacity *= Number.parseFloat(getComputedStyle(current).opacity || "1");
          current = current.parentElement;
        }
        return opacity;
      };
      const visible = (element: Element): boolean => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          cumulativeOpacity(element) > 0.01 &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.top < innerHeight
        );
      };
      const hasVisibleColor = (value: string): boolean => {
        if (value === "transparent") return false;
        const alpha = value.match(/rgba?\([^)]*[, /]([\d.]+)\)$/)?.[1];
        return alpha === undefined || Number(alpha) > 0;
      };
      const painted = (element: Element): boolean => {
        if (!visible(element)) return false;
        const style = getComputedStyle(element);
        const tag = element.localName;
        const hasText = Array.from(element.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0,
        );
        const graphic = ["svg", "canvas", "img", "video", "path", "circle", "rect"].includes(tag);
        const hasBorder =
          Number.parseFloat(style.borderTopWidth) > 0 ||
          Number.parseFloat(style.borderRightWidth) > 0 ||
          Number.parseFloat(style.borderBottomWidth) > 0 ||
          Number.parseFloat(style.borderLeftWidth) > 0;
        return (
          hasText ||
          graphic ||
          hasVisibleColor(style.backgroundColor) ||
          style.backgroundImage !== "none" ||
          hasBorder ||
          style.boxShadow !== "none"
        );
      };
      const accessibleName = (element: HTMLElement): string => {
        const ariaLabel = element.getAttribute("aria-label")?.trim();
        if (ariaLabel) return ariaLabel;
        const labelledBy = element.getAttribute("aria-labelledby")?.trim().split(/\s+/) ?? [];
        const referenced = labelledBy
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");
        if (referenced) return referenced;
        if (element.id) {
          const explicit = document.querySelector<HTMLLabelElement>(
            `label[for="${CSS.escape(element.id)}"]`,
          );
          if (explicit?.textContent?.trim()) return explicit.textContent.trim();
        }
        const wrappingLabel = element.closest("label")?.textContent?.trim();
        if (wrappingLabel) return wrappingLabel;
        const alt = element.getAttribute("alt")?.trim();
        if (alt) return alt;
        if (
          element instanceof HTMLInputElement &&
          ["button", "submit", "reset"].includes(element.type)
        ) {
          if (element.value.trim()) return element.value.trim();
        }
        return element.textContent?.trim() ?? "";
      };
      const pseudoRect = (
        element: HTMLElement,
        pseudo: "::before" | "::after",
      ): RectSnapshot | null => {
        const style = getComputedStyle(element, pseudo);
        if (
          style.content === "none" ||
          style.content === "normal" ||
          style.pointerEvents === "none"
        ) {
          return null;
        }
        const base = element.getBoundingClientRect();
        const numeric = (value: string): number | null => {
          if (value === "auto") return null;
          const parsed = Number.parseFloat(value);
          return Number.isFinite(parsed) ? parsed : null;
        };
        const left = numeric(style.left);
        const right = numeric(style.right);
        const top = numeric(style.top);
        const bottom = numeric(style.bottom);
        const styledWidth = numeric(style.width);
        const styledHeight = numeric(style.height);
        const width =
          left !== null && right !== null ? base.width - left - right : (styledWidth ?? base.width);
        const height =
          top !== null && bottom !== null
            ? base.height - top - bottom
            : (styledHeight ?? base.height);
        const x =
          left !== null ? base.x + left : right !== null ? base.right - right - width : base.x;
        const y =
          top !== null ? base.y + top : bottom !== null ? base.bottom - bottom - height : base.y;
        return { x, y, width, height };
      };
      const union = (rectangles: RectSnapshot[]): RectSnapshot => {
        const left = Math.min(...rectangles.map((rect) => rect.x));
        const top = Math.min(...rectangles.map((rect) => rect.y));
        const right = Math.max(...rectangles.map((rect) => rect.x + rect.width));
        const bottom = Math.max(...rectangles.map((rect) => rect.y + rect.height));
        return { x: left, y: top, width: right - left, height: bottom - top };
      };
      const compactFunctionalFace = (element: HTMLElement): boolean => {
        const role = element.getAttribute("role") ?? "";
        if (["checkbox", "radio", "separator", "slider", "switch"].includes(role)) return true;
        const tokens = [role, element.getAttribute("type") ?? "", element.className].join(" ");
        return /(?:switch|radio|checkbox|slider|thumb|resize(?:r|able)|handle)/i.test(tokens);
      };

      const interactiveSelector = [
        "button",
        "input",
        "select",
        "textarea",
        "a[href]",
        "[role=button]",
        "[role=tab]",
        "[role=menuitem]",
        "[role=option]",
        "[role=switch]",
        "[role=checkbox]",
        "[role=radio]",
        "[role=slider]",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",");
      const controls = Array.from(root.querySelectorAll<HTMLElement>(interactiveSelector)).filter(
        visible,
      );
      if (root.matches(interactiveSelector) && visible(root)) controls.unshift(root);

      const targets: TargetSnapshot[] = controls.map((control) => {
        const visual = rectSnapshot(control.getBoundingClientRect());
        const associatedLabel = control.closest<HTMLLabelElement>("label");
        const extras = [
          pseudoRect(control, "::before"),
          pseudoRect(control, "::after"),
          ...(associatedLabel === null
            ? []
            : [
                rectSnapshot(associatedLabel.getBoundingClientRect()),
                pseudoRect(associatedLabel, "::before"),
                pseudoRect(associatedLabel, "::after"),
              ]),
        ].filter((rect): rect is RectSnapshot => rect !== null);
        return {
          selector: selectorFor(control),
          containers: controls
            .filter((candidate) => candidate !== control && candidate.contains(control))
            .map(selectorFor),
          requiresDefaultControlFace: !compactFunctionalFace(control),
          visual,
          effective: union([visual, ...extras]),
        };
      });

      const idCounts = new Map<string, number>();
      for (const element of document.querySelectorAll<HTMLElement>("[id]")) {
        idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1);
      }
      const duplicateIds = Array.from(idCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([id]) => id);
      const referenceAttributes = [
        "aria-activedescendant",
        "aria-controls",
        "aria-describedby",
        "aria-details",
        "aria-errormessage",
        "aria-labelledby",
        "aria-owns",
      ];
      const brokenAriaReferences: string[] = [];
      for (const element of root.querySelectorAll<HTMLElement>("*")) {
        for (const attribute of referenceAttributes) {
          const value = element.getAttribute(attribute);
          if (value === null) continue;
          for (const id of value.trim().split(/\s+/).filter(Boolean)) {
            if (document.getElementById(id) !== null) continue;
            brokenAriaReferences.push(`${selectorFor(element)} ${attribute}=${id}`);
          }
        }
      }
      const unnamedControls = controls
        .filter((control) => accessibleName(control).length === 0)
        .map(selectorFor);

      let focus: SemanticSnapshot["focus"] = null;
      if (inventoryFocusTarget !== "none") {
        const focusTargets = Array.from(
          document.querySelectorAll<HTMLElement>(inventoryFocusTarget),
        );
        let focusable = focusTargets.length > 0;
        let sequential = focusTargets.length > 0;
        let indicatorVisible = focusTargets.length > 0;
        let ringContained = focusTargets.length > 0;
        let focusVisible = focusTargets.length > 0;
        let focusUnobscured = focusTargets.length > 0;
        for (const target of focusTargets) {
          target.blur();
          const initialScroll = { x: scrollX, y: scrollY };
          const focusVisualFingerprint = (): string => {
            const root = target.closest<HTMLElement>("[data-hf-ui-root]");
            const elements: HTMLElement[] = [];
            let current: HTMLElement | null = target;
            while (current !== null) {
              elements.push(current);
              if (current === root) break;
              current = current.parentElement;
            }
            return JSON.stringify(
              elements.flatMap((element) =>
                [null, "::before", "::after"].map((pseudo) => {
                  const style = getComputedStyle(element, pseudo);
                  return [
                    pseudo,
                    style.outlineStyle,
                    style.outlineWidth,
                    style.outlineColor,
                    style.outlineOffset,
                    style.boxShadow,
                    style.borderTopColor,
                    style.borderRightColor,
                    style.borderBottomColor,
                    style.borderLeftColor,
                    style.backgroundColor,
                    style.opacity,
                  ];
                }),
              ),
            );
          };
          const beforeFocus = focusVisualFingerprint();
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: "nearest", inline: "nearest" });
          if (document.activeElement !== target) focusable = false;
          if (
            target.tabIndex < 0 ||
            target.matches(":disabled, [aria-disabled='true'], [hidden], [inert]")
          ) {
            sequential = false;
          }
          const afterFocus = focusVisualFingerprint();
          if (!target.matches(":focus-visible") || beforeFocus === afterFocus) {
            indicatorVisible = false;
          }
          const focusAncestors: HTMLElement[] = [];
          let focusAncestor: HTMLElement | null = target;
          while (focusAncestor !== null) {
            focusAncestors.push(focusAncestor);
            if (focusAncestor === root) break;
            focusAncestor = focusAncestor.parentElement;
          }
          const outlined = focusAncestors.filter((element) => {
            const style = getComputedStyle(element);
            return (
              !["none", "hidden"].includes(style.outlineStyle) &&
              Number.parseFloat(style.outlineWidth) > 0
            );
          });
          for (const element of outlined) {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const extent =
              Number.parseFloat(style.outlineWidth) +
              Math.max(0, Number.parseFloat(style.outlineOffset) || 0);
            const ring = {
              left: rect.left - extent,
              top: rect.top - extent,
              right: rect.right + extent,
              bottom: rect.bottom + extent,
            };
            if (
              ring.left < 0 ||
              ring.top < 0 ||
              ring.right > innerWidth ||
              ring.bottom > innerHeight
            ) {
              ringContained = false;
            }
            let clippingAncestor = element.parentElement;
            while (clippingAncestor !== null && clippingAncestor !== document.body) {
              const clippingStyle = getComputedStyle(clippingAncestor);
              const clippingRect = clippingAncestor.getBoundingClientRect();
              const clipsX = ["hidden", "clip"].includes(clippingStyle.overflowX);
              const clipsY = ["hidden", "clip"].includes(clippingStyle.overflowY);
              if (
                (clipsX && (ring.left < clippingRect.left || ring.right > clippingRect.right)) ||
                (clipsY && (ring.top < clippingRect.top || ring.bottom > clippingRect.bottom))
              ) {
                ringContained = false;
              }
              clippingAncestor = clippingAncestor.parentElement;
            }
          }
          const rect = target.getBoundingClientRect();
          const insideViewport =
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight;
          if (!insideViewport) focusVisible = false;
          const centerX = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
          const centerY = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
          const hit = document.elementFromPoint(centerX, centerY);
          const associatedLabel = target.closest<HTMLLabelElement>("label");
          const hitBelongsToTarget =
            hit !== null &&
            (hit === target ||
              target.contains(hit) ||
              (associatedLabel !== null &&
                (hit === associatedLabel || associatedLabel.contains(hit))));
          if (!hitBelongsToTarget) focusUnobscured = false;
          scrollTo(initialScroll.x, initialScroll.y);
        }
        focus = {
          selector: inventoryFocusTarget,
          found: focusTargets.length > 0,
          focusable,
          sequential,
          indicatorVisible,
          ringContained,
          visible: focusVisible,
          unobscured: focusUnobscured,
        };
      }

      const axeResult = runAxe
        ? await window.axe.run(document, { resultTypes: ["violations"] })
        : { violations: [] };
      return {
        presentation: {
          viewport: { width: innerWidth, height: innerHeight },
          documentScrollWidth: Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ),
          documentScrollHeight: Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          ),
          root: rectSnapshot(root.getBoundingClientRect()),
          visiblePaintedNodes: [root, ...Array.from(root.querySelectorAll("*"))].filter(painted)
            .length,
        },
        targets,
        semantics: {
          axeViolations: axeResult.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            targets: violation.nodes.flatMap((node) => node.target),
          })),
          unnamedControls,
          brokenAriaReferences,
          duplicateIds,
          focus,
          reducedMotionMoving: [],
        },
        coarsePointer: matchMedia("(pointer: coarse)").matches,
      };
    },
    {
      inventoryFocusTarget: focusTarget,
      runAxe: options.runAxe ?? true,
    },
  );
}

export async function collectSemanticStateEvidence(
  page: Page,
  spec: SemanticStateFixtureSpec,
  state: SemanticFixtureState,
  options: CanonicalEvidenceOptions = {},
): Promise<SemanticStateSnapshot> {
  const dom = await page.evaluate(
    async ({ mode, relationship, state, runAxe }) => {
      const root = document.querySelector<HTMLElement>("[data-hf-ui-root]");
      const controller = document.querySelector<HTMLElement>("[data-hf-semantic-controller]");
      const region = document.querySelector<HTMLElement>("[data-hf-semantic-region]");
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const firstClass = element.classList.item(0);
        return firstClass ? `${element.localName}.${CSS.escape(firstClass)}` : element.localName;
      };
      const structurallyHidden = (element: HTMLElement | null): boolean =>
        element === null ||
        element.hidden ||
        element.closest("[hidden]") !== null ||
        getComputedStyle(element).display === "none";
      const structurallyInert = (element: HTMLElement | null): boolean =>
        element === null || element.inert || element.closest("[inert]") !== null;
      const candidateSelector = [
        "button",
        "input",
        "select",
        "textarea",
        "a[href]",
        "[contenteditable='true']",
        "[tabindex]",
      ].join(",");
      const focusCandidates = (container: HTMLElement | null): HTMLElement[] => {
        if (container === null) return [];
        const candidates = Array.from(container.querySelectorAll<HTMLElement>(candidateSelector));
        if (container.matches(candidateSelector)) candidates.unshift(container);
        return candidates;
      };
      const sequential = (element: HTMLElement): boolean =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled, [aria-disabled='true']") &&
        !structurallyHidden(element) &&
        !structurallyInert(element);
      const programmaticFocusables: string[] = [];
      for (const candidate of focusCandidates(region)) {
        const previous = document.activeElement;
        candidate.focus({ preventScroll: true });
        if (document.activeElement === candidate)
          programmaticFocusables.push(selectorFor(candidate));
        if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
        else candidate.blur();
      }
      let controllerProgrammatic = false;
      if (controller !== null) {
        controller.focus({ preventScroll: true });
        controllerProgrammatic = document.activeElement === controller;
        controller.blur();
      }
      const axeResult = runAxe
        ? await window.axe.run(document, { resultTypes: ["violations"] })
        : { violations: [] };
      return {
        state,
        mode,
        relationshipValid:
          mode === "root" ||
          (controller !== null &&
            region !== null &&
            (
              controller
                .getAttribute(relationship ?? "")
                ?.trim()
                .split(/\s+/) ?? []
            ).includes(region.id)) ||
          (state === "closed" &&
            relationship === "aria-describedby" &&
            controller !== null &&
            region !== null &&
            controller.dataset.hfSemanticRelationshipId === region.id &&
            !controller.hasAttribute("aria-describedby")),
        root: {
          found: root !== null,
          hidden: structurallyHidden(root),
          inert: structurallyInert(root),
        },
        controller:
          mode === "root"
            ? null
            : {
                found: controller !== null,
                expanded: controller?.getAttribute("aria-expanded") ?? null,
                sequential: controller !== null && sequential(controller),
                programmatic: controllerProgrammatic,
              },
        region: {
          found: region !== null,
          hidden: structurallyHidden(region),
          inert: structurallyInert(region),
          sequentialFocusables: focusCandidates(region).filter(sequential).map(selectorFor),
          programmaticFocusables,
        },
        axeViolations: axeResult.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          targets: violation.nodes.flatMap((node) => node.target),
        })),
      };
    },
    {
      mode: spec.mode,
      relationship: spec.mode === "controlled" ? spec.relationship : null,
      state,
      runAxe: options.runAxe ?? true,
    },
  );

  const session = await page.createCDPSession();
  let rootAxPresent = false;
  let controllerAxPresent = false;
  let regionAxPresent = false;
  try {
    await Promise.all([session.send("DOM.enable"), session.send("Accessibility.enable")]);
    const document = await session.send("DOM.getDocument", { depth: -1, pierce: true });
    const accessibility = await session.send("Accessibility.getFullAXTree");
    const axPresent = async (selector: string): Promise<boolean> => {
      const result = await session.send("DOM.querySelector", {
        nodeId: document.root.nodeId,
        selector,
      });
      if (result.nodeId === 0) return false;
      const described = await session.send("DOM.describeNode", {
        nodeId: result.nodeId,
        depth: -1,
        pierce: true,
      });
      const backendIds = new Set<number>();
      const collectBackendIds = (node: typeof described.node): void => {
        backendIds.add(node.backendNodeId);
        for (const child of node.children ?? []) collectBackendIds(child);
        for (const shadowRoot of node.shadowRoots ?? []) collectBackendIds(shadowRoot);
        if (node.contentDocument !== undefined) collectBackendIds(node.contentDocument);
      };
      collectBackendIds(described.node);
      return accessibility.nodes.some(
        (node) =>
          node.ignored !== true &&
          node.backendDOMNodeId !== undefined &&
          backendIds.has(node.backendDOMNodeId),
      );
    };
    [rootAxPresent, controllerAxPresent, regionAxPresent] = await Promise.all([
      axPresent("[data-hf-ui-root]"),
      axPresent("[data-hf-semantic-controller]"),
      axPresent("[data-hf-semantic-region]"),
    ]);
  } finally {
    await session.detach();
  }

  return {
    ...dom,
    root: { ...dom.root, axPresent: rootAxPresent },
    controller:
      dom.controller === null ? null : { ...dom.controller, axPresent: controllerAxPresent },
    region: { ...dom.region, axPresent: regionAxPresent },
  };
}

export async function collectReducedMotionEvidence(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-hf-ui-root]");
    if (root === null) return ["missing [data-hf-ui-root]"];
    const seconds = (value: string): number[] =>
      value.split(",").map((part) => {
        const trimmed = part.trim();
        const amount = Number.parseFloat(trimmed);
        return trimmed.endsWith("ms") ? amount / 1000 : amount;
      });
    const selectorFor = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const firstClass = element.classList.item(0);
      return firstClass ? `${element.localName}.${CSS.escape(firstClass)}` : element.localName;
    };
    const moving: string[] = [];
    for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
      const style = getComputedStyle(element);
      const transitionsMove =
        style.transitionProperty !== "none" &&
        seconds(style.transitionDuration).some((time) => time > 0);
      const animationsMove =
        style.animationName !== "none" && seconds(style.animationDuration).some((time) => time > 0);
      if (transitionsMove) {
        moving.push(`${selectorFor(element)} transition-duration=${style.transitionDuration}`);
      }
      if (animationsMove) {
        moving.push(`${selectorFor(element)} animation-duration=${style.animationDuration}`);
      }
      if (style.scrollBehavior === "smooth") {
        moving.push(`${selectorFor(element)} scroll-behavior=smooth`);
      }
    }
    return moving;
  });
}

export async function seekTimeline(page: Page, position: string | number): Promise<void> {
  await page.evaluate(async (timelinePosition) => {
    const timeline = Object.values(window.__timelines ?? {})[0];
    if (timeline === undefined) throw new Error("demo registered no timeline");
    timeline.pause();
    timeline.seek(timelinePosition, true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, position);
}

export async function collectTimelineEvidence(
  page: Page,
  declared: string[],
): Promise<TimelineSnapshot> {
  return page.evaluate(async (declaredCheckpoints) => {
    const timeline = Object.values(window.__timelines ?? {})[0];
    if (timeline === undefined) {
      return {
        declared: declaredCheckpoints,
        labels: {},
        seekErrors: [{ checkpoint: "load", message: "demo registered no timeline" }],
        consoleErrors: [],
        pageErrors: [],
        finalState: { stable: false, painted: false },
      };
    }
    const labels = { ...timeline.labels };
    const seekErrors: Array<{ checkpoint: string; message: string }> = [];
    for (const checkpoint of declaredCheckpoints) {
      try {
        timeline.pause();
        timeline.seek(checkpoint, true);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      } catch (error) {
        seekErrors.push({
          checkpoint,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      let opacity = 1;
      let current: Element | null = element;
      while (current !== null) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number.parseFloat(style.opacity || "1");
        current = current.parentElement;
      }
      return (
        opacity > 0.01 &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < innerWidth &&
        rect.top < innerHeight
      );
    };
    const fingerprint = (): string => {
      const root = document.querySelector<HTMLElement>("[data-hf-ui-root]");
      if (root === null) return "missing";
      return JSON.stringify(
        [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
          .filter(visible)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return [
              element.localName,
              element.className,
              Math.round(rect.x * 100) / 100,
              Math.round(rect.y * 100) / 100,
              Math.round(rect.width * 100) / 100,
              Math.round(rect.height * 100) / 100,
              style.opacity,
              style.transform,
              style.filter,
              style.backgroundColor,
              element.textContent?.replace(/\s+/g, " ").trim() ?? "",
            ];
          }),
      );
    };
    const hasVisibleColor = (value: string): boolean => {
      if (value === "transparent") return false;
      const match = value.match(/rgba?\([^)]*[, /]([\d.]+)\)$/);
      return match?.[1] === undefined || Number(match[1]) > 0;
    };
    const painted = (element: Element): boolean => {
      if (!visible(element)) return false;
      const style = getComputedStyle(element);
      const hasText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0,
      );
      const graphic = [
        "svg",
        "canvas",
        "img",
        "video",
        "path",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "rect",
      ].includes(element.localName);
      const hasBorder =
        Number.parseFloat(style.borderTopWidth) > 0 ||
        Number.parseFloat(style.borderRightWidth) > 0 ||
        Number.parseFloat(style.borderBottomWidth) > 0 ||
        Number.parseFloat(style.borderLeftWidth) > 0;
      return (
        hasText ||
        graphic ||
        hasVisibleColor(style.backgroundColor) ||
        style.backgroundImage !== "none" ||
        hasBorder ||
        style.boxShadow !== "none"
      );
    };
    const end = labels.end;
    let stable = false;
    let finalPainted = false;
    if (Number.isFinite(end)) {
      timeline.time(Math.max(0, end - 0.01), true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const before = fingerprint();
      timeline.time(end, true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const exact = fingerprint();
      stable = before === exact;
      const root = document.querySelector<HTMLElement>("[data-hf-ui-root]");
      finalPainted =
        root !== null &&
        [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].some(painted);
    }
    return {
      declared: declaredCheckpoints,
      labels,
      seekErrors,
      consoleErrors: [],
      pageErrors: [],
      finalState: { stable, painted: finalPainted },
    };
  }, declared);
}
