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
  /** Computed-style overrides; unset properties read as the CSS initial value. */
  style: Record<string, string> = {};
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

  /** Fake elements are created with their case-sensitive local name (e.g. `animateTransform`). */
  get localName(): string {
    return this.tagName;
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
  /** Extra `window` properties (runtime adapter registries, library globals). */
  globals?: Record<string, unknown>;
  /** Results for functions that need a real layout engine (e.g. `inspectVideoLayout`). */
  stubs?: Map<unknown, (...args: unknown[]) => unknown>;
  /** Event types of the listeners on `window`, as `DOMDebugger.getEventListeners` lists them. */
  windowListeners?: readonly string[];
  /** Make the DevTools listener lookup fail. */
  listenersUnreadable?: boolean;
  /** Event types of page listeners whose handler is a builtin (`findNativeCallbacks`). */
  nativeListeners?: readonly string[];
  /** As `nativeListeners`, but gone after the first seek, like a `once` listener the seek fires. */
  onceNativeListeners?: readonly string[];
  /** Closed shadow roots the DevTools DOM snapshot reports (page script cannot see them). */
  closedShadowRoots?: number;
}

/** The DevTools calls the planner's listener lookup sends, answered from the options. */
interface FakeCdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<void>;
}

/**
 * A `DOMSnapshot.captureSnapshot` result for the fake tree: one document,
 * every element by tag name, plus `closedShadowRoots` closed shadow roots.
 */
function fakeDomSnapshot(options: FakePageOptions): {
  documents: Array<{
    nodes: {
      parentIndex: number[];
      nodeName: number[];
      shadowRootType: { index: number[]; value: number[] };
      attributes: number[][];
    };
  }>;
  strings: string[];
} {
  const strings: string[] = [];
  const intern = (text: string) => {
    const at = strings.indexOf(text);
    return at >= 0 ? at : strings.push(text) - 1;
  };
  const elements = allElements(options.root);
  const nodeName = elements.map((el) => intern(el.tagName.toUpperCase()));
  const parentIndex = elements.map((el) =>
    el.parentElement ? elements.indexOf(el.parentElement) : -1,
  );
  const attributes = elements.map((el) =>
    Object.entries({ ...el.attrs, ...(el.id ? { id: el.id } : {}) }).flatMap(([name, v]) => [
      intern(name),
      intern(v),
    ]),
  );
  // Each closed shadow root: a host under the root holding one node, flattened as the snapshot does.
  const index: number[] = [];
  const value: number[] = [];
  for (let i = 0; i < (options.closedShadowRoots ?? 0); i++) {
    nodeName.push(intern("DIV"));
    parentIndex.push(0);
    nodeName.push(intern("SPAN"));
    parentIndex.push(nodeName.length - 2);
    attributes.push([], []);
    index.push(nodeName.length - 1);
    value.push(intern("closed"));
  }
  return {
    documents: [{ nodes: { parentIndex, nodeName, shadowRootType: { index, value }, attributes } }],
    strings,
  };
}

/** `DOMDebugger.getEventListeners`: page script handlers, then builtin ones. */
function fakeListeners(options: FakePageOptions, seeked: boolean): unknown {
  const script = { type: "function", objectId: "fn-script" };
  const native = {
    type: "function",
    objectId: "fn-native",
    description: "function max() { [native code] }",
  };
  const natives = [
    ...(options.nativeListeners ?? []),
    ...(seeked ? [] : (options.onceNativeListeners ?? [])),
  ];
  return {
    listeners: [
      ...(options.windowListeners ?? []).map((type) => ({ type, scriptId: "3", handler: script })),
      ...natives.map((type) => ({ type, scriptId: "0", handler: native })),
    ],
  };
}

/** `Runtime.getProperties`: the page script handler has a source location; nothing else has any. */
function fakeProperties(objectId: unknown): unknown {
  const internalProperties = objectId === "fn-script" ? [{ name: "[[FunctionLocation]]" }] : [];
  return { result: [], internalProperties };
}

function fakeCdpSession(options: FakePageOptions, seeked: () => boolean): FakeCdpSession {
  const answers: Record<string, (params?: Record<string, unknown>) => unknown> = {
    "DOMSnapshot.captureSnapshot": () => fakeDomSnapshot(options),
    "Runtime.evaluate": () => ({ result: { type: "object", objectId: "window-1" } }),
    "DOMDebugger.getEventListeners": () => fakeListeners(options, seeked()),
    "Runtime.queryObjects": () => ({
      objects: { type: "object", subtype: "array", objectId: "objects-1" },
    }),
    "Runtime.getProperties": (params) => fakeProperties(params?.objectId),
    "Runtime.releaseObjectGroup": () => ({}),
  };
  return {
    async send(method, params) {
      if (options.listenersUnreadable) throw new Error(`${method}: target closed`);
      const answer = answers[method];
      if (!answer) throw new Error(`fake CDP session: unexpected ${method}`);
      return answer(params);
    },
    async detach() {},
  };
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
      if (s === "*") return true;
      const attr = /^\[([a-z-]+)\]$/.exec(s);
      if (attr) return el.hasAttribute(attr[1] as string);
      return el.tagName.toLowerCase() === s;
    });
}

/** The computed values the in-page closures read, at their CSS initial values. */
const INITIAL_STYLE: Record<string, string> = {
  overflow: "visible",
  borderTopLeftRadius: "0px",
  borderTopRightRadius: "0px",
  borderBottomRightRadius: "0px",
  borderBottomLeftRadius: "0px",
  backgroundImage: "none",
};

/** `getComputedStyle`: the element's overrides (none for a pseudo-element), read by camelCase or CSS name. */
function computedStyle(el: FakeElement, pseudo?: string | null): Record<string, unknown> {
  const style: Record<string, unknown> = { ...INITIAL_STYLE, ...(pseudo ? {} : el.style) };
  style.getPropertyValue = (name: string) =>
    String(style[name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] ?? "");
  return style;
}

/** `window.fetch` for `data:` URLs only, so image sniffing runs without a network. */
async function dataUrlFetch(url: string): Promise<Response> {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!match) throw new TypeError(`fake page fetch: not a data: URL: ${url}`);
  const payload = match[2] as string;
  const bytes = match[1]
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return new Response(new Uint8Array(bytes));
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
  page: {
    evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown>;
    createCDPSession: () => Promise<FakeCdpSession>;
  };
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
    baseURI: "http://fake.test/",
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
    getComputedStyle: computedStyle,
    fetch: dataUrlFetch,
    // The virtual-time shim's record of seek callbacks: none.
    __HF_VIRTUAL_TIME__: {
      callbackActivity: () => ({
        frameCallbacks: [],
        frameCallbacksOverflow: false,
        pendingFrames: [],
        filmTimers: 0,
        stringTimers: 0,
        pendingTimers: 0,
        nativeObservers: 0,
        nativeObserverKinds: [],
        customElementDefinitions: 0,
      }),
    },
    ...options.globals,
  };
  const g = globalThis as Record<string, unknown>;
  const page = {
    createCDPSession: async (): Promise<FakeCdpSession> =>
      fakeCdpSession(options, () => seeks.length > 0),
    evaluate: async (fn: unknown, ...args: unknown[]): Promise<unknown> => {
      const stub = options.stubs?.get(fn);
      if (stub) return stub(...args);
      const prevWindow = g.window;
      const prevDocument = g.document;
      g.window = win;
      g.document = doc;
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } finally {
        g.window = prevWindow;
        g.document = prevDocument;
      }
    },
  };
  return { page, seeks };
}
