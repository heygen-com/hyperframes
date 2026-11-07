import { isElementNode, isHtmlElement } from "../domRealm";

export const isCssAnimation = (animation: Animation): animation is CSSAnimation =>
  "animationName" in animation && typeof animation.animationName === "string";

export const isKeyframeEffect = (
  effect: AnimationEffect | null | undefined,
): effect is KeyframeEffect => effect != null && "target" in effect;

// Adapted from https://github.com/heygen-com/hyperframes/blob/b7b40d3f7346c45a32b02704c5396349d9569d1b/packages/core/src/runtime/adapters/cssAnimation.ts
export const splitNames = (list: string) =>
  list.match(
    /(?:\\[\da-fA-F]{1,6}[ \t\n\r\f]?|\\.|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^ \t\n\r\f,\\])+/g,
  ) ?? [];

export function cssClip(element: Element): Element {
  let owner = element;
  for (
    let root = owner.getRootNode();
    root.nodeType === 11 && "host" in root && isElementNode(root.host);
  ) {
    owner = root.host;
    root = owner.getRootNode();
  }
  return owner.closest("[data-start]") ?? owner;
}

export function clipStartSeconds(
  clip: Element,
  resolveStartSeconds?: (element: Element) => number,
): number {
  return resolveStartSeconds
    ? resolveStartSeconds(clip)
    : Number.parseFloat(clip.getAttribute("data-start") ?? "0") || 0;
}

export function createAuthoredCssAnimations() {
  let names = new WeakMap<Element, Set<string>>();
  let cssAdapterElements = new WeakSet<Element>();
  let shadowRoots: ShadowRoot[] = [];
  let anyNames = false;

  const record = (element: Element, pseudo: string, style: CSSStyleDeclaration) => {
    const list = splitNames(style.animationName || "").filter((name) => name !== "none");
    if (!list.length) return false;
    const set = names.get(element) ?? new Set<string>();
    for (const name of list) set.add(`${pseudo} ${name}`);
    names.set(element, set);
    anyNames = true;
    return true;
  };

  const walk = (
    scope: Document | ShadowRoot,
    pseudos: string[],
    onCssAdapterElement: (element: HTMLElement, style: CSSStyleDeclaration) => void,
  ) => {
    for (const element of scope.querySelectorAll("*")) {
      const style = window.getComputedStyle(element);
      if (record(element, "", style) && scope === document && isHtmlElement(element)) {
        cssAdapterElements.add(element);
        onCssAdapterElement(element, style);
      }
      for (const pseudo of pseudos)
        record(element, pseudo, window.getComputedStyle(element, pseudo));
      if (element.shadowRoot) {
        shadowRoots.push(element.shadowRoot);
        walk(element.shadowRoot, pseudos, onCssAdapterElement);
      }
    }
  };

  const has = (animation: CSSAnimation): boolean => {
    const effect = animation.effect;
    if (!isKeyframeEffect(effect) || !effect.target) return false;
    const set = names.get(effect.target);
    const pseudo = effect.pseudoElement ?? "";
    const name = animation.animationName;
    const escaped = globalThis.CSS?.escape?.(name) ?? name;
    return (
      !!set && (set.has(`${pseudo} ${escaped}`) || set.has(`${pseudo} ${JSON.stringify(name)}`))
    );
  };

  return {
    discover: (
      onCssAdapterElement: (element: HTMLElement, style: CSSStyleDeclaration) => void = () => {},
    ) => {
      names = new WeakMap();
      cssAdapterElements = new WeakSet();
      shadowRoots = [];
      anyNames = false;
      const pseudos = typeof document.getAnimations === "function" ? ["::before", "::after"] : [];
      walk(document, pseudos, onCssAdapterElement);
    },
    shadowRoots: () => shadowRoots,
    has,
    hasAny: () => anyNames,
    drivenByCssAdapter: (animation: Animation): boolean => {
      const effect = animation.effect;
      return (
        isKeyframeEffect(effect) &&
        !!effect.target &&
        !effect.pseudoElement &&
        cssAdapterElements.has(effect.target) &&
        isCssAnimation(animation) &&
        has(animation)
      );
    },
  };
}

export type AuthoredCssAnimations = ReturnType<typeof createAuthoredCssAnimations>;
