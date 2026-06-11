// GSAP's CSSPlugin takes ownership of the element's entire transform stack
// when it tweens ANY of these — it bakes the CSS `translate` longhand into
// style.transform at init and writes `translate: none` every tick. Position
// reapply/strip logic must therefore stand down for all of them, not just x/y.
const GSAP_TRANSFORM_PROPS = [
  "x",
  "y",
  "xPercent",
  "yPercent",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "rotate",
  "rotationX",
  "rotationY",
  "skewX",
  "skewY",
  "transform",
];

/**
 * True when GSAP animates any transform-affecting property on the element,
 * meaning GSAP owns `style.transform` and has neutralized CSS `translate`.
 */
export function gsapAnimatesTransform(el: HTMLElement): boolean {
  return gsapAnimatesProperty(el, ...GSAP_TRANSFORM_PROPS);
}

/**
 * Checks whether GSAP actively animates one or more CSS/GSAP properties on
 * the given element by inspecting all registered `__timelines`.
 */
// fallow-ignore-next-line complexity
export function gsapAnimatesProperty(el: HTMLElement, ...props: string[]): boolean {
  const win = el.ownerDocument.defaultView as
    | (Window & {
        __timelines?: Record<
          string,
          {
            getChildren?: (
              deep: boolean,
            ) => Array<{ targets?: () => Element[]; vars?: Record<string, unknown> }>;
          }
        >;
      })
    | null;
  if (!win?.__timelines) return false;
  const propSet = new Set(props);
  for (const tl of Object.values(win.__timelines)) {
    if (!tl?.getChildren) continue;
    try {
      for (const child of tl.getChildren(true)) {
        if (!child.targets || !child.vars) continue;
        let targetsEl = false;
        for (const t of child.targets()) {
          if (t === el || (el.id && t.id === el.id)) {
            targetsEl = true;
            break;
          }
        }
        if (!targetsEl) continue;
        const vars = child.vars;
        for (const p of propSet) {
          if (p in vars) return true;
        }
        if (vars.keyframes && typeof vars.keyframes === "object") {
          for (const kfVal of Object.values(vars.keyframes as Record<string, unknown>)) {
            if (kfVal && typeof kfVal === "object") {
              for (const p of propSet) {
                if (p in (kfVal as Record<string, unknown>)) return true;
              }
            }
          }
        }
      }
    } catch {
      /* */
    }
  }
  return false;
}
