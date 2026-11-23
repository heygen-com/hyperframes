import {
  inspectTimelineRuntime,
  type TimelineRequest,
  type TimedAnimation,
  type TimelineRuntimeResult,
} from "./timelineInspection";
import type {
  ElementRef,
  RuntimeAnimation,
  RuntimeQuery,
  RuntimeResponse,
  RuntimeResult,
} from "./inspectionTypes";
import { isElementNode } from "./domRealm";

type Method = (this: unknown, ...args: unknown[]) => unknown;
interface Animation {
  parent?: Animation;
  vars?: Record<string, unknown>;
  targets?: () => unknown[];
  getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => Animation[];
  startTime: () => number;
  duration: () => number;
}
interface Gsap {
  core?: { Timeline?: { prototype: Record<string, unknown> } };
  getTweensOf?: (elements: Element[]) => Animation[];
  [key: string]: unknown;
}
interface InspectorWindow extends Omit<Window, "__timelines" | "gsap"> {
  gsap?: Gsap;
  __hfInspection?: {
    query: (q: RuntimeQuery) => RuntimeResponse;
    timeline: (q: TimelineRequest) => TimelineRuntimeResult;
    dispose: () => void;
  };
  __timelines?: Record<string, TimedAnimation>;
}
const animation = (value: unknown): value is Animation =>
  !!value &&
  typeof value === "object" &&
  "duration" in value &&
  typeof value.duration === "function" &&
  "startTime" in value &&
  typeof value.startTime === "function";
const reserved = new Set([
  "duration",
  "ease",
  "delay",
  "repeat",
  "repeatDelay",
  "yoyo",
  "stagger",
  "paused",
  "immediateRender",
  "overwrite",
  "lazy",
  "parent",
  "data",
  "id",
  "inherit",
  "runBackwards",
  "startAt",
  "keyframes",
  "reversed",
  "defaults",
]);

const PAGE_RESET = new Set(["*", "html", "body", ":root", "html *", "body *", ":root *", "* *"]);

function selectorAlternatives(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "/" && selector[i + 1] === "*") {
      const end = selector.indexOf("*/", i + 2);
      i = end < 0 ? selector.length : end + 1;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

export function authoredCssSelector(selector: string): string | null {
  const specific = selectorAlternatives(selector)
    .map((part) => part.trim())
    .filter((part) => part && !PAGE_RESET.has(part.replace(/\s+/g, " ").toLowerCase()));
  return specific.length > 0 ? specific.join(", ") : null;
}

export function installInspection(win: InspectorWindow, generation: string, limit = 20_000) {
  const records = new WeakMap<Animation, string>();
  const attachments = new WeakMap<Animation, string>();
  const refs = new Map<string, WeakRef<Element>>();
  const elementRefs = new WeakMap<Element, string>();
  const restorers: (() => void)[] = [];
  const hooked = new WeakSet<object>();
  let count = 0;
  let depth = 0;
  let gsap: Gsap | undefined;
  let disposed = false;
  const ref = (el: Element) => {
    let value = elementRefs.get(el);
    if (!value) {
      value = `hfi:${generation}:${refs.size + 1}`;
      refs.set(value, new WeakRef(el));
      elementRefs.set(el, value);
    }
    return value;
  };
  const ancestorId = (el: Element) => {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (parent.id) return parent.id;
    }
    return "";
  };
  const describe = (el: Element): ElementRef => ({
    ref: ref(el),
    tag: el.tagName.toLowerCase(),
    id: el.id,
    hfId: el.getAttribute("data-hf-id"),
    classes: [...el.classList],
    composition: el.closest("[data-composition-id]")?.getAttribute("data-composition-id") ?? null,
    withinId: ancestorId(el),
  });
  function record(value: unknown, stack: string) {
    if (animation(value) && !records.has(value) && count < limit) {
      records.set(value, stack);
      count++;
    }
  }
  function wrap(owner: Record<string, unknown>, name: string, timeline: boolean) {
    const original = owner[name];
    if (typeof original !== "function") return;
    const method = original as Method;
    const wrapped: Method = function (...args) {
      const outer = depth === 0;
      const stack = outer ? (new Error().stack ?? "") : "";
      const self = animation(this) ? this : undefined;
      const before =
        outer && timeline ? new Set(self?.getChildren?.(false, true, true) ?? []) : undefined;
      depth++;
      let result: unknown;
      try {
        result = method.apply(this, args);
      } finally {
        depth--;
      }
      if (outer) {
        if (name === "add" && animation(args[0])) attachments.set(args[0], stack);
        else if (before) {
          for (const child of self?.getChildren?.(false, true, true) ?? [])
            if (!before.has(child)) record(child, stack);
        } else record(result, stack);
      }
      return result;
    };
    owner[name] = wrapped;
    restorers.push(() => {
      if (owner[name] === wrapped) owner[name] = original;
    });
  }
  function hook(value: Gsap) {
    if (disposed || hooked.has(value) || !value.core?.Timeline || !value.getTweensOf) return;
    hooked.add(value);
    gsap = value;
    for (const name of ["to", "from", "fromTo", "set", "timeline", "delayedCall"])
      wrap(value, name, false);
    for (const name of ["to", "from", "fromTo", "set", "call", "add"])
      wrap(value.core.Timeline.prototype, name, true);
  }
  const descriptor = Object.getOwnPropertyDescriptor(win, "gsap");
  let value = win.gsap;
  if (value) hook(value);
  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(win, "gsap", {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (next: Gsap) => {
        value = next;
        hook(next);
      },
    });
    restorers.push(() => {
      if (descriptor)
        Object.defineProperty(win, "gsap", { ...descriptor, ...(descriptor.get ? {} : { value }) });
      else
        Object.defineProperty(win, "gsap", {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
    });
  }
  const api = {
    query(q: RuntimeQuery): RuntimeResponse {
      if (value) hook(value);
      const results = q.targets.map((target): RuntimeResult => {
        const base: RuntimeResult = {
          target,
          status: "missing",
          candidates: [],
          elements: [],
          animations: [],
          css: [],
          truncated: false,
        };
        let elements: Element[];
        try {
          if ("ref" in target) {
            const el = refs.get(target.ref)?.deref();
            if (!el?.isConnected) return { ...base, status: "stale-ref" };
            elements = [el];
          } else {
            const roots: (Document | Element)[] = target.within
              ? [...document.querySelectorAll(target.within)]
              : [document];
            const selector =
              "selector" in target ? target.selector : `[data-hf-id="${CSS.escape(target.hfId)}"]`;
            elements = [
              ...new Set(
                roots.flatMap((root) => [
                  ...(isElementNode(root) && root.matches(selector) ? [root] : []),
                  ...root.querySelectorAll(selector),
                ]),
              ),
            ];
          }
        } catch {
          return { ...base, status: "invalid-selector" };
        }
        if (elements.length === 0)
          return {
            ...base,
            status: "missing",
            candidates: elements.slice(0, 20).map(describe),
            truncated: elements.length > 20,
          };
        const selected = new Set<Element>();
        let truncated = false;
        const add = (el: Element) => {
          if (selected.has(el)) return;
          if (selected.size >= 1001) {
            truncated = true;
            return;
          }
          selected.add(el);
        };
        for (const element of elements) {
          add(element);
          if (q.descendants) {
            for (const child of element.querySelectorAll("*")) {
              add(child);
              if (truncated) break;
            }
          }
          if (truncated) break;
        }
        const scope = [...selected];
        const animations = (gsap?.getTweensOf?.(scope) ?? []).map((tw): RuntimeAnimation => {
          const attachmentStacks: string[] = [];
          const visited = new Set<Animation>();
          for (
            let parent: Animation | undefined = tw;
            parent && !visited.has(parent);
            parent = parent.parent
          ) {
            visited.add(parent);
            const stack = attachments.get(parent);
            if (stack) attachmentStacks.push(stack);
          }
          return {
            stack: records.get(tw) ?? null,
            properties: Object.keys(tw.vars ?? {}).filter(
              (key) => !reserved.has(key) && !key.startsWith("on"),
            ),
            targets: (tw.targets?.() ?? []).filter(isElementNode).slice(0, 50).map(describe),
            localStart: tw.startTime(),
            duration: tw.duration(),
            attachmentStacks,
          };
        });
        const css = q.cssRules
          .filter((rule) => {
            const selector = authoredCssSelector(rule.selector);
            if (!selector) return false;
            try {
              return scope.some((el) => el.matches(selector));
            } catch {
              return false;
            }
          })
          .map((rule) => rule.id);
        return {
          ...base,
          status: "found",
          candidates: elements.slice(0, 1001).map(describe),
          elements: scope.map(describe),
          animations,
          css,
          truncated,
        };
      });
      return { results, recorded: count, recordLimitReached: count >= limit, hooked: !!gsap };
    },
    timeline(q: TimelineRequest): TimelineRuntimeResult {
      let scope: Element = document.documentElement;
      if (q.component) {
        const found = api.query({ targets: [q.component], descendants: false, cssRules: [] })
          .results[0];
        if (!found) return { status: "missing", candidates: [], events: [], warnings: [] };
        if (found.status !== "found")
          return { status: found.status, candidates: found.candidates, events: [], warnings: [] };
        const [only, ...others] = found.candidates;
        if (!only || others.length > 0)
          return { status: "ambiguous", candidates: found.candidates, events: [], warnings: [] };
        const el = refs.get(only.ref)?.deref();
        if (!el) return { status: "stale-ref", candidates: [], events: [], warnings: [] };
        scope = el;
      }
      const registered = Object.values(win.__timelines ?? {});
      const roots = registered.filter(
        (root) =>
          !registered.some(
            (other) =>
              other !== root && (other.getChildren?.(true, false, true) ?? []).includes(root),
          ),
      );
      return inspectTimelineRuntime(
        q,
        roots,
        scope,
        describe,
        (a) => records.get(a) ?? null,
        reserved,
        win.__timelines ?? {},
      );
    },
    dispose() {
      disposed = true;
      for (const restore of restorers.reverse()) restore();
      refs.clear();
      delete win.__hfInspection;
    },
  };
  win.__hfInspection = api;
  return api;
}
