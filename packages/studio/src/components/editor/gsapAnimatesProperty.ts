import { parseAnimeJsScriptAcorn } from "@hyperframes/core/animejs-parser-acorn";

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

function animePropertyCandidates(property: string): string[] {
  if (property === "x") return ["translateX"];
  if (property === "y") return ["translateY"];
  if (property === "z") return ["translateZ"];
  if (property === "rotation") return ["rotate", "rotateZ"];
  if (property === "rotationX") return ["rotateX"];
  if (property === "rotationY") return ["rotateY"];
  if (property === "rotationZ") return ["rotateZ"];
  return [property];
}

function animePropsFor(props: string[]): Set<string> {
  const result = new Set<string>();
  for (const prop of props) {
    for (const candidate of animePropertyCandidates(prop)) result.add(candidate);
  }
  return result;
}

function elementMatchesAnimeSelector(el: HTMLElement, selector: string): boolean {
  if (selector === `#${el.id}`) return true;
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

function animeScriptTexts(doc: Document): string[] {
  const texts: string[] = [];
  for (const script of doc.querySelectorAll<HTMLScriptElement>("script:not([src])")) {
    const text = script.textContent || "";
    if (text.includes("anime.") || text.includes("hyperframesAnime")) texts.push(text);
  }
  return texts;
}

// fallow-ignore-next-line complexity
function animeAnimatesProperty(el: HTMLElement, ...props: string[]): boolean {
  const propSet = animePropsFor(props);
  for (const text of animeScriptTexts(el.ownerDocument)) {
    try {
      const parsed = parseAnimeJsScriptAcorn(text);
      for (const animation of parsed.animations) {
        if (!elementMatchesAnimeSelector(el, animation.targetSelector)) continue;
        for (const prop of propSet) {
          if (prop in animation.properties) return true;
          if (animation.propertyKeyframes && prop in animation.propertyKeyframes) return true;
        }
      }
    } catch {
      /* unparsable/dynamic anime source falls back to the normal DOM path */
    }
  }
  return false;
}

export function animationRuntimeAnimatesProperty(el: HTMLElement, ...props: string[]): boolean {
  return gsapAnimatesProperty(el, ...props) || animeAnimatesProperty(el, ...props);
}
