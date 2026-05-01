export function createStudioManualEditsRenderBodyScript(manifestContent: string): string | null {
  if (!manifestContent.trim()) return null;
  return `(${studioManualEditsRenderRuntime.toString()})(${JSON.stringify(manifestContent)});`;
}

function studioManualEditsRenderRuntime(manifestContent: string): void {
  const OFFSET_X_PROP = "--hf-studio-offset-x";
  const OFFSET_Y_PROP = "--hf-studio-offset-y";
  const WIDTH_PROP = "--hf-studio-width";
  const HEIGHT_PROP = "--hf-studio-height";
  const ROTATION_PROP = "--hf-studio-rotation";
  const WRAPPED_SEEK_PROP = "__hfStudioManualEditsWrapped";

  const finiteNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const objectRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : null;

  const parsedManifest = (() => {
    try {
      return objectRecord(JSON.parse(manifestContent));
    } catch {
      return null;
    }
  })();
  const manifestEdits = Array.isArray(parsedManifest?.edits) ? parsedManifest.edits : [];
  if (manifestEdits.length === 0) return;

  const findClosestByAttribute = (
    element: HTMLElement,
    attributeNames: string[],
  ): HTMLElement | null => {
    let current: HTMLElement | null = element;
    while (current) {
      const candidate = current;
      if (attributeNames.some((attribute) => candidate.hasAttribute(attribute))) {
        return candidate;
      }
      current = current.parentElement;
    }
    return null;
  };

  const sourceFileForElement = (element: HTMLElement): string => {
    const ownerRoot = findClosestByAttribute(element, ["data-composition-id"]);
    return (
      ownerRoot?.getAttribute("data-composition-file") ??
      ownerRoot?.getAttribute("data-composition-src") ??
      "index.html"
    );
  };

  const elementMatchesSourceFile = (element: HTMLElement, sourceFile: string): boolean =>
    sourceFileForElement(element) === sourceFile;

  const querySelectorCandidates = (selector: string): HTMLElement[] => {
    const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1];
    if (className) {
      return Array.from(document.getElementsByTagName("*")).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element.classList.contains(className),
      );
    }

    if (/^[A-Za-z][A-Za-z0-9-]*$/.test(selector)) {
      return Array.from(document.getElementsByTagName(selector)).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
    }

    return Array.from(document.querySelectorAll(selector)).filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
  };

  const resolveTarget = (edit: Record<string, unknown>): HTMLElement | null => {
    const targetRecord = objectRecord(edit.target);
    if (!targetRecord) return null;

    const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
    if (!sourceFile) return null;

    const id = typeof targetRecord.id === "string" ? targetRecord.id : "";
    if (id) {
      const byId = document.getElementById(id);
      if (byId instanceof HTMLElement && elementMatchesSourceFile(byId, sourceFile)) return byId;

      const matchesById = [
        document.documentElement,
        ...Array.from(document.getElementsByTagName("*")),
      ].filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element.id === id &&
          elementMatchesSourceFile(element, sourceFile),
      );
      if (matchesById[0]) return matchesById[0];
    }

    const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : "";
    if (!selector) return null;

    try {
      const matches = querySelectorCandidates(selector).filter((element) =>
        elementMatchesSourceFile(element, sourceFile),
      );
      const selectorIndex = finiteNumber(targetRecord.selectorIndex) ?? 0;
      return matches[Math.max(0, Math.floor(selectorIndex))] ?? null;
    } catch {
      return null;
    }
  };

  const roundRotationAngle = (angle: number): number => Math.round(angle * 10) / 10;

  const isSimpleRotateAngle = (value: string): boolean =>
    /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|rad|turn|grad)$/.test(value.trim());

  const composeRotation = (element: HTMLElement, rotationValue: string): string => {
    const original = element.getAttribute("data-hf-studio-original-rotate")?.trim();
    if (!original || original === "none" || !isSimpleRotateAngle(original)) {
      return rotationValue;
    }
    return `calc(${original} + ${rotationValue})`;
  };

  const applyPathOffset = (element: HTMLElement, edit: Record<string, unknown>): void => {
    const x = finiteNumber(edit.x);
    const y = finiteNumber(edit.y);
    if (x == null || y == null) return;
    element.setAttribute("data-hf-studio-path-offset", "true");
    element.style.setProperty(OFFSET_X_PROP, `${Math.round(x)}px`);
    element.style.setProperty(OFFSET_Y_PROP, `${Math.round(y)}px`);
    element.style.setProperty("translate", `var(${OFFSET_X_PROP}, 0px) var(${OFFSET_Y_PROP}, 0px)`);
  };

  const readParentFlexBasisPixels = (
    element: HTMLElement,
    size: { width: number; height: number },
  ): number | null => {
    const parent = element.parentElement;
    if (!parent) return null;
    const styles = getComputedStyle(parent);
    if (styles.display !== "flex" && styles.display !== "inline-flex") return null;
    return Math.round(
      Math.max(1, styles.flexDirection.startsWith("column") ? size.height : size.width),
    );
  };

  const applyBoxSize = (element: HTMLElement, edit: Record<string, unknown>): void => {
    const width = finiteNumber(edit.width);
    const height = finiteNumber(edit.height);
    if (width == null || height == null || width <= 0 || height <= 0) return;

    const rounded = {
      width: Math.round(Math.max(1, width)),
      height: Math.round(Math.max(1, height)),
    };
    element.setAttribute("data-hf-studio-box-size", "true");
    element.style.setProperty(WIDTH_PROP, `${rounded.width}px`);
    element.style.setProperty(HEIGHT_PROP, `${rounded.height}px`);
    element.style.setProperty("box-sizing", "border-box");
    element.style.setProperty("width", `${rounded.width}px`);
    element.style.setProperty("height", `${rounded.height}px`);
    element.style.setProperty("min-width", "0px");
    element.style.setProperty("min-height", "0px");
    element.style.setProperty("max-width", "none");
    element.style.setProperty("max-height", "none");

    const flexBasis = readParentFlexBasisPixels(element, rounded);
    if (flexBasis != null) {
      element.style.setProperty("flex-basis", `${flexBasis}px`);
      element.style.setProperty("flex-grow", "0");
      element.style.setProperty("flex-shrink", "0");
    }
    if (getComputedStyle(element).display === "inline") {
      element.style.setProperty("display", "inline-block");
    }
  };

  const applyRotation = (element: HTMLElement, edit: Record<string, unknown>): void => {
    const angle = finiteNumber(edit.angle);
    if (angle == null) return;
    if (!element.hasAttribute("data-hf-studio-rotation")) {
      element.setAttribute(
        "data-hf-studio-original-rotate",
        element.style.getPropertyValue("rotate"),
      );
    }
    element.setAttribute("data-hf-studio-rotation", "true");
    element.style.setProperty(ROTATION_PROP, `${roundRotationAngle(angle)}deg`);
    element.style.setProperty("rotate", composeRotation(element, `var(${ROTATION_PROP}, 0deg)`));
  };

  const applyManifest = (): number => {
    let applied = 0;
    for (const edit of manifestEdits) {
      const editRecord = objectRecord(edit);
      if (!editRecord) continue;
      const element = resolveTarget(editRecord);
      if (!element) continue;
      if (editRecord.kind === "path-offset") applyPathOffset(element, editRecord);
      if (editRecord.kind === "box-size") applyBoxSize(element, editRecord);
      if (editRecord.kind === "rotation") applyRotation(element, editRecord);
      applied += 1;
    }
    return applied;
  };

  const markWrapped = (fn: (time: number) => unknown): void => {
    try {
      Object.defineProperty(fn, WRAPPED_SEEK_PROP, {
        configurable: false,
        enumerable: false,
        value: true,
      });
    } catch {
      try {
        (fn as unknown as Record<string, unknown>)[WRAPPED_SEEK_PROP] = true;
      } catch {
        // Ignore non-extensible functions.
      }
    }
  };

  const isWrapped = (fn: (time: number) => unknown): boolean =>
    Boolean((fn as unknown as Record<string, unknown>)[WRAPPED_SEEK_PROP]);

  const wrapFunction = (owner: Record<string, unknown> | undefined, key: string): boolean => {
    const fn = owner?.[key];
    if (!owner || typeof fn !== "function") return false;
    const seek = fn as (time: number) => unknown;
    if (isWrapped(seek)) {
      applyManifest();
      return true;
    }

    const wrappedSeek = function (this: unknown, time: number): unknown {
      const result = seek.call(this, time);
      applyManifest();
      return result;
    };
    markWrapped(wrappedSeek);
    owner[key] = wrappedSeek;
    applyManifest();
    return true;
  };

  const wrapSeekFunctions = (): boolean => {
    const runtimeWindow = window as Window & {
      __hf?: { seek?: (time: number) => unknown };
      __player?: { renderSeek?: (time: number) => unknown };
    };
    const wrappedHfSeek = wrapFunction(runtimeWindow.__hf, "seek");
    const wrappedPlayerRenderSeek = wrapFunction(runtimeWindow.__player, "renderSeek");
    return wrappedHfSeek || wrappedPlayerRenderSeek;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyManifest(), { once: true });
  } else {
    applyManifest();
  }

  wrapSeekFunctions();
  let remainingSeekWrapAttempts = 120;
  const seekWrapInterval = setInterval(() => {
    wrapSeekFunctions();
    remainingSeekWrapAttempts -= 1;
    if (remainingSeekWrapAttempts <= 0) clearInterval(seekWrapInterval);
  }, 50);
}
