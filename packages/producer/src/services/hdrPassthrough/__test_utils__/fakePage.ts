// fallow-ignore-file unused-class-member
/**
 * A minimal stand-in for the composition page, for the passthrough planner and
 * eligibility tests: just enough DOM, GSAP timeline and runtime surface for
 * the in-page closures (`computeStaticFrameSet`, `collectOverlayPageFacts`,
 * `inspectVideoAnimation`) to run in-process. `page.evaluate(fn, ...args)`
 * calls `fn(...args)` with `window` / `document` swapped in.
 */

export class FakeElement {
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  animations: unknown[] = [];
  readonly nodeType = 1;

  constructor(
    readonly tagName: string,
    readonly id: string,
    readonly attrs: Record<string, string> = {},
  ) {}

  get dataset(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.attrs)) {
      if (name.startsWith("data-")) {
        out[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
      }
    }
    return out;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return name in this.attrs;
  }

  contains(other: FakeElement | null): boolean {
    for (let node = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }

  getAnimations(): unknown[] {
    return this.animations;
  }

  append(...kids: FakeElement[]): this {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
}

export interface FakeTweenSpec {
  start: number;
  duration: number;
  targets?: FakeElement[];
  vars?: Record<string, unknown>;
  repeat?: number;
}

/** Duck-typed like the GSAP members the engine walker reads. */
class FakeTween {
  parent: FakeTimeline | null = null;
  readonly vars: Record<string, unknown>;

  constructor(private readonly spec: FakeTweenSpec) {
    this.vars = spec.vars ?? {};
  }
  startTime(): number {
    return this.spec.start;
  }
  duration(): number {
    return this.spec.duration;
  }
  totalDuration(): number {
    return this.spec.duration * ((this.spec.repeat ?? 0) + 1);
  }
  timeScale(): number {
    return 1;
  }
  targets(): FakeElement[] {
    return this.spec.targets ?? [];
  }
}

export class FakeTimeline {
  parent: FakeTimeline | null = null;
  readonly children: Array<FakeTween | FakeTimeline> = [];
  vars: Record<string, unknown> = {};
  private scale = 1;

  constructor(private start = 0) {}

  startTime(): number {
    return this.start;
  }
  duration(): number {
    return this.children.reduce(
      (end, child) => Math.max(end, child.startTime() + child.totalDuration()),
      0,
    );
  }
  totalDuration(): number {
    return this.duration();
  }
  timeScale(value?: number): number {
    if (value !== undefined) this.scale = value;
    return this.scale;
  }
  targets(): FakeElement[] {
    return [];
  }

  tween(spec: FakeTweenSpec): this {
    const tween = new FakeTween(spec);
    tween.parent = this;
    this.children.push(tween);
    return this;
  }

  set(target: FakeElement, at: number, vars: Record<string, unknown> = { opacity: 1 }): this {
    return this.tween({ start: at, duration: 0, targets: [target], vars });
  }

  call(at: number): this {
    return this.tween({ start: at, duration: 0, vars: { onComplete: () => {} } });
  }

  add(child: FakeTimeline, at: number): this {
    child.parent = this;
    child.start = at;
    this.children.push(child);
    return this;
  }

  getChildren(
    nested: boolean,
    tweens: boolean,
    timelines: boolean,
  ): Array<FakeTween | FakeTimeline> {
    const out: Array<FakeTween | FakeTimeline> = [];
    for (const child of this.children) {
      const isTimeline = child instanceof FakeTimeline;
      if ((isTimeline && timelines) || (!isTimeline && tweens)) out.push(child);
      if (isTimeline && nested) out.push(...child.getChildren(true, tweens, timelines));
    }
    return out;
  }
}

export interface FakePageOptions {
  /** Root element (usually the composition root); every element must descend from it. */
  root: FakeElement;
  /** Composition duration (`window.__hf.duration`). */
  duration: number;
  timelines?: Record<string, FakeTimeline>;
  globalTimeline?: FakeTimeline;
  /** Overrides `__hf.clipWindow`; default derives it from `data-start` / `data-duration`. */
  clipWindow?: (el: FakeElement) => { start: number; end: number } | null;
  hasClipResolver?: boolean;
  transitions?: unknown[];
  /** Results for functions that need a real layout engine (e.g. `inspectVideoLayout`). */
  stubs?: Map<unknown, (...args: unknown[]) => unknown>;
}

function allElements(root: FakeElement): FakeElement[] {
  const out: FakeElement[] = [];
  const visit = (el: FakeElement) => {
    out.push(el);
    for (const kid of el.children) visit(kid);
  };
  visit(root);
  return out;
}

function matches(el: FakeElement, selector: string): boolean {
  return selector
    .split(",")
    .map((s) => s.trim())
    .some((s) => {
      const attr = /^\[([a-z-]+)\]$/.exec(s);
      if (attr) return el.hasAttribute(attr[1] as string);
      return el.tagName.toLowerCase() === s;
    });
}

function defaultClipWindow(el: FakeElement): { start: number; end: number } | null {
  const start = el.getAttribute("data-start");
  if (start == null)
    return el.hasAttribute("data-composition-id") ? { start: 0, end: Infinity } : null;
  const s = Number(start);
  const d = Number(el.getAttribute("data-duration"));
  return { start: s, end: Number.isFinite(d) && d > 0 ? s + d : Infinity };
}

export function createFakePage(options: FakePageOptions): {
  page: { evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown> };
  seeks: number[];
} {
  const seeks: number[] = [];
  const html = new FakeElement("html", "");
  const body = new FakeElement("body", "");
  html.append(body.append(options.root));
  const elements = () => allElements(options.root);
  const doc = {
    documentElement: html,
    body,
    getElementById: (id: string) => elements().find((el) => el.id === id) ?? null,
    querySelectorAll: (selector: string) => elements().filter((el) => matches(el, selector)),
    querySelector: (selector: string) => elements().find((el) => matches(el, selector)) ?? null,
    getAnimations: () => elements().flatMap((el) => el.animations),
  };
  const win = {
    __timelines: options.timelines ?? {},
    __hf: {
      duration: options.duration,
      transitions: options.transitions ?? [],
      seek: (t: number) => seeks.push(t),
      ...(options.hasClipResolver === false
        ? {}
        : { clipWindow: options.clipWindow ?? defaultClipWindow }),
    },
    __hfHasFrameSources: () => false,
    gsap: options.globalTimeline ? { globalTimeline: options.globalTimeline } : undefined,
  };
  const g = globalThis as Record<string, unknown>;
  const page = {
    evaluate: async (fn: unknown, ...args: unknown[]): Promise<unknown> => {
      const stub = options.stubs?.get(fn);
      if (stub) return stub(...args);
      const prevWindow = g.window;
      const prevDocument = g.document;
      g.window = win;
      g.document = doc;
      try {
        return (fn as (...a: unknown[]) => unknown)(...args);
      } finally {
        g.window = prevWindow;
        g.document = prevDocument;
      }
    },
  };
  return { page, seeks };
}
