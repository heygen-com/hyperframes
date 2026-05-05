import type { RuntimeJson, RuntimeOutboundMessage, RuntimePickerElementInfo } from "./types";

type PickerModuleDeps = {
  postMessage: (payload: RuntimeOutboundMessage) => void;
};

const PICKER_IGNORE_SELECTOR = [
  "[data-hyperframes-ignore]",
  "[data-hyperframes-picker-ignore]",
  "[data-hf-ignore]",
  "[data-no-inspect]",
  "[data-no-pick]",
  "[data-hyper-shader-loading]",
].join(",");
const PICKER_BLOCK_SELECTOR = [
  "[data-hyperframes-picker-block]",
  "[data-hyper-shader-loading]",
].join(",");

export type PickerModule = {
  enablePickMode: () => void;
  disablePickMode: () => void;
  installPickerApi: () => void;
};

export function createPickerModule(deps: PickerModuleDeps): PickerModule {
  let pickModeActive = false;
  let pickModeHighlightEl: Element | null = null;
  let pickModeStyleEl: HTMLStyleElement | null = null;
  let pickLastHoveredInfo: RuntimePickerElementInfo | null = null;
  let pickLastSelectedInfo: RuntimePickerElementInfo | null = null;

  function emitPickerRuntimeEvent(eventName: string, detail: RuntimeJson): void {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch {
      // no-op in unsupported contexts
    }
  }

  function setLastHoveredInfo(info: RuntimePickerElementInfo | null): void {
    pickLastHoveredInfo = info;
    emitPickerRuntimeEvent("hyperframe:picker:hovered", {
      elementInfo: pickLastHoveredInfo,
      isPickMode: pickModeActive,
      timestamp: Date.now(),
    });
  }

  function setLastSelectedInfo(info: RuntimePickerElementInfo | null): void {
    pickLastSelectedInfo = info;
    emitPickerRuntimeEvent("hyperframe:picker:selected", {
      elementInfo: pickLastSelectedInfo,
      isPickMode: pickModeActive,
      timestamp: Date.now(),
    });
  }

  function isPickableElement(el: Element | null): el is Element {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") return false;
    if (el.classList.contains("__hf-pick-highlight")) return false;
    if (el.closest(PICKER_IGNORE_SELECTOR)) return false;
    return true;
  }

  function blocksPickerAtPoint(el: Element | null): boolean {
    return Boolean(el?.closest(PICKER_BLOCK_SELECTOR));
  }

  function buildElementSelector(el: Element): string {
    const htmlEl = el as HTMLElement;
    if (htmlEl.id) return `#${htmlEl.id}`;
    const compositionId = el.getAttribute("data-composition-id");
    if (compositionId) return `[data-composition-id="${compositionId}"]`;
    const compositionSrc = el.getAttribute("data-composition-src");
    if (compositionSrc) return `[data-composition-src="${compositionSrc}"]`;
    const track = el.getAttribute("data-track-index");
    if (track) return `[data-track-index="${track}"]`;
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return tag;
    const siblings = parent.querySelectorAll(`:scope > ${tag}`);
    if (siblings.length === 1) return tag;
    for (let i = 0; i < siblings.length; i += 1) {
      if (siblings[i] === el) return `${tag}:nth-of-type(${i + 1})`;
    }
    return tag;
  }

  function buildElementLabel(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
    const trimLabel = (value: string, maxChars: number) =>
      value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
    if (tag === "h1" || tag === "h2" || tag === "h3") return "Heading";
    if (tag === "p" || tag === "span" || tag === "div")
      return text.length > 0 ? trimLabel(text, 56) : "Text";
    if (tag === "img") return "Image";
    if (tag === "video") return "Video";
    if (tag === "audio") return "Audio";
    if (tag === "svg") return "Shape";
    if (el.getAttribute("data-composition-src")) return "Composition";
    if (tag === "section") return "Section";
    return `${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
  }

  function getPickCandidatesFromPoint(clientX: number, clientY: number, limit?: number): Element[] {
    const maxCandidates = typeof limit === "number" && limit > 0 ? limit : 8;
    let raw: Element[] = [];
    if (document.elementsFromPoint) {
      raw = document.elementsFromPoint(clientX, clientY);
    } else if (document.elementFromPoint) {
      const single = document.elementFromPoint(clientX, clientY);
      raw = single ? [single] : [];
    }
    if (blocksPickerAtPoint(raw[0] ?? null)) return [];
    const dedupe: Record<string, true> = {};
    const candidates: Element[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const node = raw[i];
      if (!isPickableElement(node)) continue;
      const key = `${node.tagName}::${(node as HTMLElement).id || ""}::${i}`;
      if (dedupe[key]) continue;
      dedupe[key] = true;
      candidates.push(node);
      if (candidates.length >= maxCandidates) break;
    }
    return candidates;
  }

  function extractElementInfo(el: Element): RuntimePickerElementInfo {
    const rect = el.getBoundingClientRect();
    const dataAttributes: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i += 1) {
      const attr = el.attributes[i];
      if (attr.name.startsWith("data-")) {
        dataAttributes[attr.name] = attr.value;
      }
    }
    const htmlEl = el as HTMLElement;
    return {
      id: htmlEl.id || null,
      tagName: el.tagName.toLowerCase(),
      selector: buildElementSelector(el),
      label: buildElementLabel(el),
      boundingBox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      textContent: el.textContent ? el.textContent.trim().slice(0, 200) : null,
      src: el.getAttribute("src") || el.getAttribute("data-composition-src") || null,
      dataAttributes,
    };
  }

  function getPickInfosFromPoint(
    clientX: number,
    clientY: number,
    limit?: number,
  ): RuntimePickerElementInfo[] {
    return getPickCandidatesFromPoint(clientX, clientY, limit).map(extractElementInfo);
  }

  function onPickMouseMove(event: MouseEvent): void {
    if (!pickModeActive) return;
    const candidates = getPickCandidatesFromPoint(event.clientX, event.clientY, 1);
    const target = candidates[0] ?? (event.target instanceof Element ? event.target : null);
    if (!isPickableElement(target)) return;
    if (pickModeHighlightEl === target) return;
    if (pickModeHighlightEl) {
      pickModeHighlightEl.classList.remove("__hf-pick-highlight");
    }
    pickModeHighlightEl = target;
    target.classList.add("__hf-pick-highlight");
    const info = extractElementInfo(target);
    setLastHoveredInfo(info);
    deps.postMessage({ source: "hf-preview", type: "element-hovered", elementInfo: info });
  }

  function onPickClick(event: MouseEvent): void {
    if (!pickModeActive) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const infos = getPickInfosFromPoint(event.clientX, event.clientY, 8);
    if (infos.length === 0) return;
    setLastHoveredInfo(infos[0] ?? null);
    deps.postMessage({
      source: "hf-preview",
      type: "element-pick-candidates",
      candidates: infos,
      selectedIndex: 0,
      point: { x: event.clientX, y: event.clientY },
    });
  }

  function onPickKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    disablePickMode();
    deps.postMessage({ source: "hf-preview", type: "pick-mode-cancelled" });
  }

  function enablePickMode(): void {
    if (pickModeActive) return;
    pickModeActive = true;
    pickModeStyleEl = document.createElement("style");
    pickModeStyleEl.textContent = [
      ".__hf-pick-highlight { outline: 2px solid #4f8cf7 !important; outline-offset: 2px; cursor: crosshair !important; }",
      ".__hf-pick-active * { cursor: crosshair !important; }",
    ].join("\n");
    document.head.appendChild(pickModeStyleEl);
    document.body.classList.add("__hf-pick-active");
    document.addEventListener("mousemove", onPickMouseMove, true);
    document.addEventListener("click", onPickClick, true);
    document.addEventListener("keydown", onPickKeyDown, true);
    emitPickerRuntimeEvent("hyperframe:picker:mode", { isPickMode: true, timestamp: Date.now() });
  }

  function disablePickMode(): void {
    if (!pickModeActive) return;
    pickModeActive = false;
    if (pickModeHighlightEl) {
      pickModeHighlightEl.classList.remove("__hf-pick-highlight");
      pickModeHighlightEl = null;
    }
    if (pickModeStyleEl) {
      pickModeStyleEl.remove();
      pickModeStyleEl = null;
    }
    document.body.classList.remove("__hf-pick-active");
    document.removeEventListener("mousemove", onPickMouseMove, true);
    document.removeEventListener("click", onPickClick, true);
    document.removeEventListener("keydown", onPickKeyDown, true);
    emitPickerRuntimeEvent("hyperframe:picker:mode", { isPickMode: false, timestamp: Date.now() });
  }

  function installPickerApi(): void {
    window.__HF_PICKER_API = {
      enable: enablePickMode,
      disable: disablePickMode,
      isActive: () => pickModeActive,
      getHovered: () => pickLastHoveredInfo,
      getSelected: () => pickLastSelectedInfo,
      getCandidatesAtPoint: (clientX, clientY, limit) =>
        Number.isFinite(clientX) && Number.isFinite(clientY)
          ? getPickInfosFromPoint(clientX, clientY, limit)
          : [],
      pickAtPoint: (clientX, clientY, index) => {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
        const infos = getPickInfosFromPoint(clientX, clientY, 8);
        if (!infos.length) return null;
        const safeIndex = Math.max(0, Math.min(infos.length - 1, Number(index ?? 0)));
        const selected = infos[safeIndex] ?? null;
        if (!selected) return null;
        setLastSelectedInfo(selected);
        deps.postMessage({ source: "hf-preview", type: "element-picked", elementInfo: selected });
        disablePickMode();
        return selected;
      },
      pickManyAtPoint: (clientX, clientY, indexes) => {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return [];
        const infos = getPickInfosFromPoint(clientX, clientY, 8);
        if (!infos.length) return [];
        const selected: RuntimePickerElementInfo[] = [];
        const rawIndexes = Array.isArray(indexes) ? indexes : [0];
        for (const rawIndex of rawIndexes) {
          const idx = Math.max(0, Math.min(infos.length - 1, Math.floor(Number(rawIndex))));
          const info = infos[idx];
          if (!info) continue;
          const duplicate = selected.some(
            (item) => item.selector === info.selector && item.tagName === info.tagName,
          );
          if (!duplicate) selected.push(info);
        }
        if (!selected.length) return [];
        setLastSelectedInfo(selected[0] ?? null);
        deps.postMessage({
          source: "hf-preview",
          type: "element-picked-many",
          elementInfos: selected,
        });
        disablePickMode();
        return selected;
      },
    };
    emitPickerRuntimeEvent("hyperframe:picker:api-ready", { hasApi: true, timestamp: Date.now() });
  }

  return { enablePickMode, disablePickMode, installPickerApi };
}
