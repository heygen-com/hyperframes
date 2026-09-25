import { PICKER_STYLES } from "./styles";
import type { ExtensionResponse, SelectionRect } from "../protocol";
import { serializeEditableDom } from "../capture/dom";
import { containsCanvas, discoverSameOriginGlb } from "../capture/model";

function describeElement(element: Element): string {
  const className = element.getAttribute("class") ?? "";
  const firstClass = className.trim().split(/\s+/).find(Boolean);
  const label = `${element.tagName.toLowerCase()}${firstClass ? `.${firstClass}` : ""}`;
  return label.length > 42 ? `${label.slice(0, 41)}…` : label;
}

function selectionRect(element: Element): SelectionRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function isSuccessfulResponse(value: unknown): value is Extract<ExtensionResponse, { ok: true }> {
  return value !== null && typeof value === "object" && "ok" in value && value.ok === true;
}

class Picker {
  private readonly host = document.createElement("div");
  private readonly root: ShadowRoot;
  private readonly frame: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly live: HTMLElement;
  private readonly previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private epoch = crypto.randomUUID();
  private candidate: Element | null = null;
  private state: "picking" | "capturing" | "locked" | "copying" | "copied" | "failed" = "picking";
  private lockedText: string | null = null;

  constructor() {
    this.host.setAttribute("data-hyperframes-capture", "");
    this.host.setAttribute("data-hyperframes-capture-state", "picking");
    this.host.style.cssText =
      "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    this.root = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = PICKER_STYLES;
    this.root.append(style);

    const layer = document.createElement("div");
    layer.className = "layer";
    layer.innerHTML = `
      <div class="frame" aria-hidden="true"><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i></div>
      <div class="tag" aria-hidden="true"><strong></strong><span></span></div>
      <div class="bar" role="status"><span class="mark" aria-hidden="true">H</span><b>Pick a frame</b><span class="hints"><i><kbd>↑</kbd> parent</i><i><kbd>↓</kbd> child</i><i><kbd>Enter</kbd> lock</i><i><kbd>Esc</kbd> cancel</i></span></div>
      <span class="sr" aria-live="polite"></span>`;
    this.root.append(layer);
    const frame = this.root.querySelector<HTMLElement>(".frame");
    const tag = this.root.querySelector<HTMLElement>(".tag");
    const bar = this.root.querySelector<HTMLElement>(".bar");
    const live = this.root.querySelector<HTMLElement>(".sr");
    if (!frame || !tag || !bar || !live) throw new Error("Picker UI failed to initialize.");
    this.frame = frame;
    this.tag = tag;
    this.bar = bar;
    this.live = live;
    document.documentElement.append(this.host);
    this.listen();
    this.announce("Picker ready. Move the pointer or use arrow keys, then press Enter to lock.");
  }

  activate(): void {
    if (this.state === "picking") {
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.bar.animate(
          [
            { transform: "translateX(-50%) scale(.98)" },
            { transform: "translateX(-50%) scale(1)" },
          ],
          { duration: 160 },
        );
      }
      this.announce("Picker already open.");
    }
  }

  private listen(): void {
    document.addEventListener("pointermove", this.onPointerMove, true);
    document.addEventListener("click", this.onClick, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("scroll", this.update, true);
    window.addEventListener("resize", this.update, true);
  }

  private stopPicking(): void {
    document.removeEventListener("pointermove", this.onPointerMove, true);
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("scroll", this.update, true);
    window.removeEventListener("resize", this.update, true);
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const target = event.composedPath()[0];
    if (target instanceof Element && target !== this.host && !this.host.contains(target)) {
      this.candidate = target;
      this.update();
    }
  };

  private readonly onClick = (event: MouseEvent) => {
    if (!this.candidate || this.state !== "picking") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.lock();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.destroy();
      return;
    }
    if (!this.candidate || this.state !== "picking") return;
    if (event.key === "ArrowUp" && this.candidate.parentElement) {
      event.preventDefault();
      this.candidate = this.candidate.parentElement;
      this.update();
    } else if (event.key === "ArrowDown" && this.candidate.firstElementChild) {
      event.preventDefault();
      this.candidate = this.candidate.firstElementChild;
      this.update();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void this.lock();
    }
  };

  private readonly update = () => {
    if (!this.candidate?.isConnected) return;
    const rect = this.candidate.getBoundingClientRect();
    this.host.setAttribute("data-hyperframes-candidate-tag", this.candidate.tagName.toLowerCase());
    this.host.setAttribute("data-hyperframes-candidate-id", this.candidate.id);
    this.host.setAttribute("data-hyperframes-candidate-left", String(Math.round(rect.left)));
    this.host.setAttribute("data-hyperframes-candidate-top", String(Math.round(rect.top)));
    this.host.setAttribute("data-hyperframes-candidate-width", String(Math.round(rect.width)));
    this.host.setAttribute("data-hyperframes-candidate-height", String(Math.round(rect.height)));
    this.frame.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    const tagTop = Math.max(8, rect.top - 32);
    const tagLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 250));
    this.tag.style.left = `${tagLeft}px`;
    this.tag.style.top = `${tagTop}px`;
    const name = this.tag.querySelector("strong");
    const dimensions = this.tag.querySelector("span");
    if (name) name.textContent = describeElement(this.candidate);
    if (dimensions)
      dimensions.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  };

  private async lock(): Promise<void> {
    const target = this.candidate;
    if (!target || !target.isConnected || this.state !== "picking") return;
    this.state = "capturing";
    this.host.setAttribute("data-hyperframes-capture-state", "capturing");
    this.stopPicking();
    const rect = selectionRect(target);
    const modelCandidate = containsCanvas(target)
      ? await discoverSameOriginGlb(
          performance.getEntriesByType("resource").map((entry) => ({ name: entry.name })),
          location.href,
        )
      : null;
    const editableResult = serializeEditableDom(target, modelCandidate);
    if (!editableResult.ok) {
      this.host.setAttribute("data-hyperframes-serializer-code", editableResult.reason);
      if (editableResult.actual !== undefined) {
        this.host.setAttribute("data-hyperframes-serializer-actual", String(editableResult.actual));
      }
    }
    this.host.style.visibility = "hidden";
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const response: unknown = await chrome.runtime.sendMessage({
      kind: "capture-selection",
      epoch: this.epoch,
      rect,
      editable: editableResult.ok ? editableResult.capture : null,
    });
    this.host.style.visibility = "visible";
    if (!isSuccessfulResponse(response) || response.kind !== "locked") {
      this.state = "failed";
      this.host.setAttribute("data-hyperframes-capture-state", "failed");
      this.showFailure(
        response && typeof response === "object" && "message" in response
          ? String(response.message)
          : "Chrome could not lock that selection.",
      );
      return;
    }
    this.state = "locked";
    this.host.setAttribute("data-hyperframes-capture-state", "locked");
    this.host.setAttribute("data-hyperframes-artifact-kind", response.artifactKind);
    this.host.setAttribute("data-hyperframes-model-islands", String(response.modelIslandCount));
    if (response.fallbackCode) {
      this.host.setAttribute("data-hyperframes-fallback-code", response.fallbackCode);
    }
    this.lockedText = response.text;
    this.frame.remove();
    this.tag.remove();
    this.bar.remove();
    this.showCapsule(response);
  }

  private showCapsule(response: Extract<ExtensionResponse, { ok: true; kind: "locked" }>): void {
    const capsule = document.createElement("section");
    capsule.className = "capsule";
    capsule.setAttribute("role", "dialog");
    capsule.setAttribute("aria-modal", "true");
    capsule.setAttribute("aria-labelledby", "hf-capture-title");
    const note =
      response.artifactKind === "editable-dom"
        ? response.modelIslandCount > 0
          ? `${response.modelIslandCount} live 3D ${response.modelIslandCount === 1 ? "model stays" : "models stay"} local and editable. Camera, materials, environment, transform, and animation remain yours in Studio.`
          : response.opaqueIslandCount > 0
            ? `DOM and text stay editable. ${response.opaqueIslandCount} opaque visual ${response.opaqueIslandCount === 1 ? "is" : "islands are"} frozen locally.`
            : "DOM, text, layout, and styles stay editable. No page code or remote URL comes with it."
        : response.completeness === "cropped"
          ? "Editable capture could not stay honest. The visible portion is locked as a Still."
          : "Editable capture could not stay honest. A complete visible Still is locked instead.";
    capsule.innerHTML = `
      <div class="preview"><img alt="Locked capture preview"></div>
      <div class="body"><p class="eyebrow">${response.modelIslandCount > 0 ? "Editable HTML + Live 3D" : response.artifactKind === "editable-dom" ? "Editable HTML" : `Still · ${response.completeness}`}</p><h2 id="hf-capture-title">Ready for Studio</h2>
      <div class="meta"><span>${response.width} × ${response.height}</span><span>${Math.ceil(response.bytes / 1024)} KB</span><span>${response.modelIslandCount > 0 ? "HTML + GLB" : response.artifactKind === "editable-dom" ? "HTML" : "PNG"}</span></div>
      <p class="note"></p><div class="actions"><button class="secondary" type="button">Cancel</button><button class="primary" type="button">Copy to Studio</button></div></div>`;
    const image = capsule.querySelector<HTMLImageElement>("img");
    const noteElement = capsule.querySelector<HTMLElement>(".note");
    const cancel = capsule.querySelector<HTMLButtonElement>(".secondary");
    const copy = capsule.querySelector<HTMLButtonElement>(".primary");
    if (!image || !noteElement || !cancel || !copy) throw new Error("Locked capsule failed.");
    image.src = response.previewDataUrl;
    noteElement.textContent = note;
    cancel.addEventListener("click", () => this.destroy());
    copy.addEventListener("click", () => void this.copy(copy, noteElement));
    capsule.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.destroy();
      if (event.key === "Tab") {
        const active = this.root.activeElement;
        if ((event.shiftKey && active === cancel) || (!event.shiftKey && active === copy)) {
          event.preventDefault();
          if (event.shiftKey) copy.focus();
          else cancel.focus();
        }
      }
    });
    this.root.append(capsule);
    copy.focus();
    this.announce(note);
  }

  private async copy(button: HTMLButtonElement, note: HTMLElement): Promise<void> {
    if (!this.lockedText || (this.state !== "locked" && this.state !== "failed")) return;
    this.state = "copying";
    button.disabled = true;
    button.textContent = "Copying…";
    const response: unknown = await chrome.runtime.sendMessage({
      kind: "write-clipboard",
      epoch: this.epoch,
      text: this.lockedText,
    });
    if (isSuccessfulResponse(response) && response.kind === "copied") {
      this.state = "copied";
      this.host.setAttribute("data-hyperframes-capture-state", "copied");
      button.textContent = "Copied ✓";
      note.textContent = "Paste in HyperFrames Studio with ⌘V or Ctrl+V.";
      this.announce("Copied. Paste in HyperFrames Studio.");
      return;
    }
    this.state = "failed";
    this.host.setAttribute("data-hyperframes-capture-state", "failed");
    button.disabled = false;
    button.textContent = "Retry copy";
    note.textContent =
      response && typeof response === "object" && "message" in response
        ? String(response.message)
        : "The clipboard write failed. Your locked capture is still here.";
    this.announce(note.textContent);
  }

  private showFailure(message: string): void {
    this.host.style.pointerEvents = "auto";
    this.host.setAttribute("data-hyperframes-failure-message", message);
    this.frame.remove();
    this.tag.remove();
    const label = this.bar.querySelector("b");
    if (label) label.textContent = message;
    this.bar.style.borderColor = "rgba(248,113,113,.65)";
    this.announce(message);
  }

  private announce(message: string): void {
    this.live.textContent = "";
    requestAnimationFrame(() => {
      this.live.textContent = message;
    });
  }

  private destroy(): void {
    this.stopPicking();
    this.host.remove();
    this.previousFocus?.focus();
  }
}

const picker = new Picker();

chrome.runtime.onMessage.addListener((raw, _sender, respond) => {
  if (raw === null || typeof raw !== "object" || !("kind" in raw) || raw.kind !== "activate")
    return;
  picker.activate();
  respond({ ok: true, kind: "activated" });
});
