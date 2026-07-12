// fallow-ignore-file complexity code-duplication
/**
 * 3D-context projection for drawElementImage fast capture.
 *
 * drawElementImage cannot paint CSS 3D rendering contexts: backface-visibility
 * is ignored (flip cards capture their mirrored backface, even at rest),
 * siblings of the context drop out of the capture, and the context's
 * background is lost (standalone repro: spikes/de-3d-probe.mjs; Chrome
 * 148–151). There is no capture-side workaround — layoutsubtree children
 * never paint to screen, so CDP screenshots are blind during fast capture,
 * and drawElementImage only accepts immediate canvas children.
 *
 * Instead the composition is rewritten in-page before capture starts:
 * each 3D context (a `perspective` container, or a bare `preserve-3d`
 * subtree) is replaced by a WebGL canvas that projects the context's leaf
 * quads with the same math Blink's compositor uses. Leaf content is
 * rasterized once via SVG foreignObject (fonts and images inlined as data
 * URLs — SVG-as-image loads no external resources), uploaded as textures,
 * and re-projected every frame from the live computed `transform` matrices,
 * so GSAP keeps driving the (hidden) original elements and the projection
 * follows. Backface-visibility maps to GL face culling.
 *
 * The inserted canvases are picked up by instrumentAcceleratedCanvases
 * (preserveDrawingBuffer forced) and composited under the DOM paint by
 * captureDrawElementFrame — zero new capture-path code.
 *
 * Fidelity (spikes/de-3d-webgl-probe.mjs, flip card vs Blink 3D):
 * 74–77 dB at rest, 46–58 dB mid-flip — edge-AA differences only.
 *
 * v1 limitations (documented, fall back to the 3D gate when hit):
 *  - layout offsets inside a context are measured once at init; contexts
 *    whose layout (not transform) animates will drift.
 *  - background-image inlining covers <img> and computed background-image
 *    url(...) values; other external references rasterize empty.
 */

import type { Page } from "puppeteer-core";

export interface ThreeDProjectionResult {
  ok: boolean;
  groups: number;
  quads: number;
  /** standalone 3D-tweened elements projected as single quads */
  selfQuads?: number;
  /** raw tween-target entries reported by the producer stub */
  stubTargets?: number;
  reason?: string;
}

/**
 * Run inside the page (page.evaluate) after page-ready and BEFORE
 * injectDrawElementCanvas. Self-contained: no outer-scope references.
 */
export async function initThreeDProjectionInPage(): Promise<ThreeDProjectionResult> {
  type Mat4 = number[]; // row-major 4x4

  const root = document.querySelector("[data-composition-id]") as HTMLElement | null;
  if (!root) return { ok: true, groups: 0, quads: 0 };

  // ── discovery ──────────────────────────────────────────────────────────
  // A computed matrix3d whose 3x3 part mixes z with x/y (or that carries a
  // perspective row) renders WRONG under drawElementImage — the rotation is
  // silently dropped (flat rotateX captures unsquashed; see
  // spikes/de-3d-flat-test.mjs). translateZ-only matrix3d without
  // perspective is a visual no-op and safe to leave alone.
  const isThreeDMatrix = (transform: string): boolean => {
    if (!transform.startsWith("matrix3d")) return false;
    // parse the argument list only — the "3" in "matrix3d" is NOT a value
    const n = (transform.slice(transform.indexOf("(") + 1).match(/-?[\d.e+-]+/g) ?? []).map(Number);
    if (n.length !== 16) return false;
    const eps = 1e-6;
    // column-major: rotation cross terms + perspective row
    const cross = [n[2], n[6], n[8], n[9], n[3], n[7], n[11]];
    if (cross.some((v) => Math.abs(v ?? 0) > eps)) return true;
    return Math.abs((n[10] ?? 1) - 1) > eps; // z scale from X/Y rotation
  };

  const isContextRoot = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    if (cs.perspective !== "none") return true;
    // bare preserve-3d without a perspective ancestor still forms a 3D
    // rendering context (orthographic) and still breaks the capture
    if (cs.transformStyle === "preserve-3d") {
      const parent = el.parentElement;
      if (!parent || getComputedStyle(parent).perspective === "none") return true;
    }
    return false;
  };

  const groupRoots: HTMLElement[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    const el = node as HTMLElement;
    if (groupRoots.some((g) => g.contains(el))) {
      node = walker.nextNode();
      continue;
    }
    if (isContextRoot(el)) groupRoots.push(el);
    node = walker.nextNode();
  }

  // Standalone 3D-tweened elements: no perspective container, no
  // preserve-3d — just GSAP rotationX/rotationY (gen_os scene entrances).
  // Two sources: elements already at a 3D matrix at t=0 (from()/fromTo()
  // immediateRender), and the producer stub's record of every tween target
  // whose vars carried 3D keys (catches to()-style tweens that are still
  // flat at init).
  const selfQuadEls = new Set<HTMLElement>();
  const claimed = (el: HTMLElement): boolean =>
    groupRoots.some((g) => g === el || g.contains(el) || el.contains(g));
  {
    const w3d = window as Window & { __hf3dTweenTargets?: unknown[] };
    for (const target of w3d.__hf3dTweenTargets ?? []) {
      let els: HTMLElement[] = [];
      if (typeof target === "string") {
        try {
          els = Array.from(document.querySelectorAll(target)) as HTMLElement[];
        } catch {
          els = [];
        }
      } else if (target instanceof HTMLElement) {
        els = [target];
      } else if (Array.isArray(target)) {
        els = target.filter((t): t is HTMLElement => t instanceof HTMLElement);
      }
      for (const el of els) {
        if (root.contains(el) && !claimed(el)) selfQuadEls.add(el);
      }
    }
    const scan = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n2 = scan.nextNode();
    while (n2) {
      const el = n2 as HTMLElement;
      if (!claimed(el) && !selfQuadEls.has(el) && isThreeDMatrix(getComputedStyle(el).transform)) {
        // skip descendants of an already-recorded self quad
        let covered = false;
        for (const s of selfQuadEls) {
          if (s.contains(el)) {
            covered = true;
            break;
          }
        }
        if (!covered) selfQuadEls.add(el);
      }
      n2 = scan.nextNode();
    }
  }

  if (groupRoots.length === 0 && selfQuadEls.size === 0) {
    return { ok: true, groups: 0, quads: 0 };
  }

  // Quad textures are rasterized ONCE — a GSAP-animated element inside a
  // quad's subtree would freeze at its init state (gen_os scene entrances
  // 3D-rotate whole scenes whose content keeps animating; measured: golf
  // dropped from 46 dB to 24 dB without this guard). Resolve every tween
  // target the stub saw; quads containing one fall back to the baseline
  // route.
  const animatedEls = new Set<HTMLElement>();
  {
    const wAll = window as Window & { __hfAllTweenTargets?: unknown[] };
    for (const target of wAll.__hfAllTweenTargets ?? []) {
      if (typeof target === "string") {
        try {
          for (const el of Array.from(document.querySelectorAll(target))) {
            if (el instanceof HTMLElement) animatedEls.add(el);
          }
        } catch {
          /* invalid selector */
        }
      } else if (target instanceof HTMLElement) {
        animatedEls.add(target);
      } else if (Array.isArray(target)) {
        for (const t of target) if (t instanceof HTMLElement) animatedEls.add(t);
      }
    }
  }
  const hasAnimatedStrictDescendant = (el: HTMLElement): boolean => {
    for (const a of animatedEls) {
      if (a !== el && el.contains(a)) return true;
    }
    return false;
  };

  // ── shared rasterization helpers ───────────────────────────────────────
  const toDataUrl = async (url: string): Promise<string> => {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(`FileReader failed for ${url}`));
      r.readAsDataURL(blob);
    });
  };

  // All @font-face rules with their src urls re-fetched as data URLs, so the
  // SVG image (which loads no external resources) can still use the fonts.
  const buildFontCss = async (): Promise<string> => {
    const rules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let cssRules: CSSRuleList;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet
      }
      for (const rule of Array.from(cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        let text = rule.cssText;
        const urls = Array.from(text.matchAll(/url\((['"]?)([^'")]+)\1\)/g));
        for (const m of urls) {
          const src = m[2];
          if (!src) continue;
          try {
            const data = await toDataUrl(new URL(src, document.baseURI).href);
            text = text.replace(m[0], `url(${data})`);
          } catch {
            // unfetchable font src — leave as-is; SVG will skip it
          }
        }
        rules.push(text);
      }
    }
    return rules.join("\n");
  };
  const fontCss = await buildFontCss();

  const URL_VALUE_PATTERN = /url\((['"]?)(?!data:)([^'")]+)\1\)/g;

  // Copy computed styles onto the clone tree and inline external resources.
  const inlineCloneStyles = async (orig: HTMLElement, clone: HTMLElement): Promise<void> => {
    const origEls: HTMLElement[] = [
      orig,
      ...(Array.from(orig.querySelectorAll("*")) as HTMLElement[]),
    ];
    const cloneEls: HTMLElement[] = [
      clone,
      ...(Array.from(clone.querySelectorAll("*")) as HTMLElement[]),
    ];
    for (let i = 0; i < origEls.length; i++) {
      const source = origEls[i];
      const target = cloneEls[i];
      if (!source || !target || !target.style) continue;
      const cs = getComputedStyle(source);
      let cssText = "";
      for (const prop of Array.from(cs)) {
        cssText += `${prop}:${cs.getPropertyValue(prop)};`;
      }
      target.setAttribute("style", cssText);
      target.removeAttribute("class");
      const bg = cs.getPropertyValue("background-image");
      if (bg && bg !== "none") {
        let inlined = bg;
        for (const m of Array.from(bg.matchAll(URL_VALUE_PATTERN))) {
          const src = m[2];
          if (!src) continue;
          try {
            inlined = inlined.replace(m[0], `url(${await toDataUrl(src)})`);
          } catch {
            /* leave */
          }
        }
        target.style.backgroundImage = inlined;
      }
    }
    for (const img of Array.from(clone.querySelectorAll("img"))) {
      const src = img.getAttribute("src");
      if (src && !src.startsWith("data:")) {
        try {
          img.setAttribute("src", await toDataUrl(new URL(src, document.baseURI).href));
        } catch {
          img.removeAttribute("src");
        }
      }
    }
  };

  const rasterizeQuad = async (el: HTMLElement, shell: boolean): Promise<HTMLImageElement> => {
    const w = Math.max(1, Math.ceil(el.offsetWidth));
    const h = Math.max(1, Math.ceil(el.offsetHeight));
    const clone = el.cloneNode(true) as HTMLElement;
    await inlineCloneStyles(el, clone);
    if (shell) {
      // shell quads carry only the element's own paint — element children
      // are projected as their own quads
      for (const child of Array.from(clone.children)) {
        (child as HTMLElement).style.display = "none";
      }
    }
    // rasterize untransformed, fully visible, at the texture origin —
    // live transform and opacity are applied at draw time per frame
    clone.style.transform = "none";
    clone.style.position = "static";
    clone.style.top = "0";
    clone.style.left = "0";
    clone.style.margin = "0";
    clone.style.visibility = "visible";
    clone.style.opacity = "1";
    clone.style.clipPath = "none";
    clone.style.backfaceVisibility = "visible";
    const xml = new XMLSerializer().serializeToString(clone);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      (fontCss ? `<style>${fontCss.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</style>` : "") +
      `<foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    return img;
  };

  // ── matrix helpers (CSS convention: x right, y down, z toward viewer) ──
  const ident = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const mul = (a: Mat4, b: Mat4): Mat4 => {
    const o = new Array<number>(16).fill(0);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        for (let k = 0; k < 4; k++)
          o[r * 4 + c] = (o[r * 4 + c] ?? 0) + (a[r * 4 + k] ?? 0) * (b[k * 4 + c] ?? 0);
    return o;
  };
  const translate = (x: number, y: number, z = 0): Mat4 => {
    const m = ident();
    m[3] = x;
    m[7] = y;
    m[11] = z;
    return m;
  };
  const perspectiveMat = (d: number): Mat4 => {
    const m = ident();
    m[14] = -1 / d;
    return m;
  };
  /** Parse computed `transform` ("none" | matrix(...) | matrix3d(...)) into row-major Mat4. */
  const parseTransform = (value: string): Mat4 => {
    if (!value || value === "none") return ident();
    // parse the argument list only — the "3" in "matrix3d" is NOT a value
    const nums = (value.slice(value.indexOf("(") + 1).match(/-?[\d.e+-]+/g) ?? []).map(Number);
    const at = (i: number): number => nums[i] ?? 0;
    if (value.startsWith("matrix3d") && nums.length === 16) {
      // CSS matrix3d is column-major; convert to row-major
      // fallow-ignore-next-line code-duplication
      return [
        at(0),
        at(4),
        at(8),
        at(12),
        at(1),
        at(5),
        at(9),
        at(13),
        at(2),
        at(6),
        at(10),
        at(14),
        at(3),
        at(7),
        at(11),
        at(15),
      ];
    }
    if (nums.length === 6) {
      return [at(0), at(2), 0, at(4), at(1), at(3), 0, at(5), 0, 0, 1, 0, 0, 0, 0, 1];
    }
    return ident();
  };
  const parseOrigin = (value: string): [number, number, number] => {
    const nums = (value.match(/-?[\d.]+/g) ?? []).map(Number);
    return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
  };
  // WebGL1 requires transpose=false in uniformMatrix4fv — convert here.
  const colMajor = (m: Mat4): Float32Array => {
    const at = (i: number): number => m[i] ?? 0;
    // fallow-ignore-next-line code-duplication
    return new Float32Array([
      at(0),
      at(4),
      at(8),
      at(12),
      at(1),
      at(5),
      at(9),
      at(13),
      at(2),
      at(6),
      at(10),
      at(14),
      at(3),
      at(7),
      at(11),
      at(15),
    ]);
  };

  // ── per-group setup ────────────────────────────────────────────────────
  interface Quad {
    el: HTMLElement;
    /** elements whose transforms compose onto this quad, group child → quad */
    chain: HTMLElement[];
    /** layout offset of each chain element inside its parent, measured untransformed */
    offsets: Array<[number, number]>;
    tex: WebGLTexture;
    buf: WebGLBuffer;
    backfaceHidden: boolean;
  }
  interface Group {
    rootEl: HTMLElement;
    gl: WebGLRenderingContext;
    prog: WebGLProgram;
    quads: Quad[];
    perspective: number; // 0 = none (orthographic)
    perspOrigin: [number, number];
    pad: number;
    canvasW: number;
    canvasH: number;
  }
  const groups: Group[] = [];

  // Every element that needs its transform projected per-frame rather than
  // baked into a texture: preserve-3d members, elements at a 3D matrix now,
  // and the stub's 3D tween targets.
  const threeDNodes = new Set<HTMLElement>(selfQuadEls);
  {
    const scan3 = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n3 = scan3.nextNode();
    while (n3) {
      const el = n3 as HTMLElement;
      const cs = getComputedStyle(el);
      if (cs.transformStyle === "preserve-3d" || isThreeDMatrix(cs.transform)) {
        threeDNodes.add(el);
      }
      n3 = scan3.nextNode();
    }
  }
  const subtreeHasThreeD = (el: HTMLElement): boolean => {
    for (const node3 of threeDNodes) {
      if (el !== node3 && el.contains(node3)) return true;
    }
    return false;
  };
  // Does the element paint anything of its own (background, border, or
  // direct text), apart from its element children?
  const hasOwnPaint = (el: HTMLElement): boolean => {
    const cs = getComputedStyle(el);
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") {
      return true;
    }
    if (cs.backgroundImage !== "none") return true;
    if (Number.parseFloat(cs.borderTopWidth) > 0 || Number.parseFloat(cs.borderLeftWidth) > 0) {
      return true;
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "") {
        return true;
      }
    }
    return false;
  };

  interface QuadDesc {
    el: HTMLElement;
    chain: HTMLElement[];
    /** rasterize only the element's own paint — children are projected separately */
    shell: boolean;
  }

  const collectQuads = (parent: HTMLElement, chain: HTMLElement[], out: QuadDesc[]): void => {
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      const cs = getComputedStyle(child);
      if (cs.display === "none") continue;
      if (child instanceof HTMLCanvasElement) continue;
      // recurse when the child itself is a 3D scene member OR contains one —
      // its descendants' transforms must be projected live, not baked into
      // a texture at init state.
      if (cs.transformStyle === "preserve-3d" || subtreeHasThreeD(child)) {
        if (hasOwnPaint(child)) out.push({ el: child, chain: [...chain, child], shell: true });
        collectQuads(child, [...chain, child], out);
      } else {
        out.push({ el: child, chain: [...chain, child], shell: false });
      }
    }
  };

  const VS =
    "attribute vec3 p; attribute vec2 t; uniform mat4 m; varying vec2 v;" +
    "void main(){ gl_Position = m * vec4(p,1.0); v = t; }";
  // textures are premultiplied — scaling all four channels applies opacity
  const FS =
    "precision mediump float; uniform sampler2D s; uniform float a; varying vec2 v;" +
    "void main(){ gl_FragColor = texture2D(s, v) * a; }";

  // Context groups project their descendants; standalone 3D-tweened
  // elements project themselves as a single quad.
  const groupSpecs: Array<{ g: HTMLElement; self: boolean }> = [
    ...groupRoots.map((g) => ({ g, self: false })),
    ...Array.from(selfQuadEls).map((g) => ({ g, self: true })),
  ];

  for (const { g, self } of groupSpecs) {
    const quadDescs: QuadDesc[] = [];
    if (self) {
      quadDescs.push({ el: g, chain: [], shell: false });
    } else {
      collectQuads(g, [], quadDescs);
    }
    if (quadDescs.length === 0) continue;

    // Measure untransformed layout geometry once: zero out every transform in
    // the group, force layout, record offsets/sizes, restore. gen_os comps
    // animate transform/opacity only, so these stay valid for the render.
    const allChainEls = Array.from(new Set([g, ...quadDescs.flatMap((q) => q.chain)]));
    const savedTransforms = allChainEls.map((el) => el.style.transform);
    for (const el of allChainEls) el.style.transform = "none";
    void g.offsetWidth; // force layout
    const geoOffsets = new Map<HTMLElement, [number, number]>();
    const geoSizes = new Map<HTMLElement, [number, number]>();
    for (const el of allChainEls) {
      const parent = el.parentElement === g ? g : (el.parentElement as HTMLElement);
      const pRect = parent.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      geoOffsets.set(el, [r.left - pRect.left, r.top - pRect.top]);
      geoSizes.set(el, [el.offsetWidth, el.offsetHeight]);
    }
    for (let i = 0; i < allChainEls.length; i++) {
      const el = allChainEls[i];
      if (el) el.style.transform = savedTransforms[i] ?? "";
    }

    // Degenerate 3D markup guard: gen_os flip cards are inline <span>s —
    // transforms on non-replaced inline boxes are not transformable per
    // spec, the boxes measure 0×0, and Blink renders the (centered, flexed)
    // text as overflow of an empty box. A texture quad cannot reproduce
    // that; route the whole render to the baseline path instead.
    for (const desc of quadDescs) {
      const leafSize = geoSizes.get(desc.el) ?? [0, 0];
      const inlineInChain = [g, ...desc.chain].some(
        (el) => getComputedStyle(el).display === "inline",
      );
      if (leafSize[0] < 1 || leafSize[1] < 1 || inlineInChain) {
        return {
          ok: false,
          groups: 0,
          quads: 0,
          reason:
            "degenerate 3D geometry (zero-size or inline-box quad) — " +
            "quad projection cannot reproduce Blink's lenient rendering",
        };
      }
      // shell textures exclude element children, so only leaves can bake
      // a stale animation state
      if (!desc.shell && hasAnimatedStrictDescendant(desc.el)) {
        return {
          ok: false,
          groups: 0,
          quads: 0,
          reason:
            "3D quad contains GSAP-animated descendants — static texture " +
            "would freeze them at init state",
        };
      }
    }

    const gw = g.offsetWidth;
    const gh = g.offsetHeight;
    const pad = Math.ceil(Math.max(gw, gh) * 0.25);
    const canvasW = gw + pad * 2;
    const canvasH = gh + pad * 2;

    // The canvas lives NEXT TO the group (in its offsetParent), positioned
    // at the group's untransformed layout box. The group's own animated
    // transform is composed into the projection matrices per frame instead
    // of being inherited from the DOM — the group subtree is fully hidden.
    const anchor = (g.offsetParent as HTMLElement | null) ?? g.parentElement ?? root;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-hf-3d", "");
    canvas.width = canvasW;
    canvas.height = canvasH;
    canvas.style.cssText =
      `position:absolute;left:${g.offsetLeft - pad}px;top:${g.offsetTop - pad}px;` +
      `width:${canvasW}px;height:${canvasH}px;pointer-events:none;` +
      `z-index:${getComputedStyle(g).zIndex === "auto" ? "0" : getComputedStyle(g).zIndex};`;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      // instrumentAcceleratedCanvases forces this too, but the module must
      // not depend on instrumentation order: the composite drawImage happens
      // after a paint yield, and a non-preserved buffer reads blank there.
      preserveDrawingBuffer: true,
    }) as WebGLRenderingContext | null;
    if (!gl) return { ok: false, groups: 0, quads: 0, reason: "webgl unavailable" };

    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type);
      if (!s) throw new Error("createShader failed");
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(String(gl.getShaderInfoLog(s)));
      }
      return s;
    };
    const prog = gl.createProgram();
    if (!prog) throw new Error("createProgram failed");
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // the y-flip in the NDC mapping reverses winding: local CCW arrives CW
    gl.frontFace(gl.CW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const cs = getComputedStyle(g);
    const perspective = cs.perspective === "none" ? 0 : Number.parseFloat(cs.perspective);
    const pOrigin = parseOrigin(cs.perspectiveOrigin);

    // Neutralize the 3D rendering context on the live (hidden) elements.
    // clip-path alone is NOT enough: the context still exists in the layer
    // tree and drawElementImage keeps dropping the group's earlier siblings
    // and background (measured on the fast-capture-3d test comp: headline
    // sibling missing with clip-path-only hiding). The projection math has
    // already captured perspective above and composes per-element computed
    // transforms itself, so the DOM context is no longer needed. GSAP only
    // writes `transform`, so these stick.
    g.style.perspective = "none";
    // capture authored backface flags BEFORE neutralizing them — the quads
    // below read these for GL culling
    const backfaceHiddenByEl = new Map<HTMLElement, boolean>();
    for (const desc of quadDescs) {
      backfaceHiddenByEl.set(desc.el, getComputedStyle(desc.el).backfaceVisibility === "hidden");
    }
    for (const el of allChainEls) {
      el.style.transformStyle = "flat";
      // backface-visibility:hidden + a 3D matrix poisons the capture even
      // on a flat element (the face is "facing away") — culling is the
      // GL renderer's job now
      el.style.backfaceVisibility = "visible";
    }

    const quads: Quad[] = [];
    for (const desc of quadDescs) {
      const img = await rasterizeQuad(desc.el, desc.shell);
      const tex = gl.createTexture();
      if (!tex) throw new Error("createTexture failed");
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const size = geoSizes.get(desc.el) ?? [desc.el.offsetWidth, desc.el.offsetHeight];
      const [qw, qh] = size;
      // quad in element-local coords, origin at the element's top-left, CCW
      const verts = new Float32Array([
        0,
        0,
        0,
        0,
        1,
        qw,
        0,
        0,
        1,
        1,
        qw,
        qh,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        1,
        qw,
        qh,
        0,
        1,
        0,
        0,
        qh,
        0,
        0,
        0,
      ]);
      const buf = gl.createBuffer();
      if (!buf) throw new Error("createBuffer failed");
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

      quads.push({
        el: desc.el,
        chain: desc.chain,
        offsets: desc.chain.map((el) => geoOffsets.get(el) ?? [0, 0]),
        tex,
        buf,
        backfaceHidden: backfaceHiddenByEl.get(desc.el) ?? false,
      });
    }

    // Hide via clip-path, NOT visibility/opacity: GSAP autoAlpha tweens
    // write inline visibility and opacity on these same elements every
    // frame and would un-hide them. clip-path is never animated by the
    // composition, paints nothing, and keeps layout + computed styles
    // (transform/opacity/visibility) fully readable for the projection.
    g.style.clipPath = "inset(100%)";
    anchor.appendChild(canvas);

    groups.push({
      rootEl: g,
      gl,
      prog,
      quads,
      perspective,
      perspOrigin: [pOrigin[0], pOrigin[1]],
      pad,
      canvasW,
      canvasH,
    });
  }

  // ── per-frame update ───────────────────────────────────────────────────
  // Depth: raw z values blow past the |z| <= w clip volume (near/far-plane
  // clipping collapses the quad to a sliver), so z is scaled into a safe
  // range while keeping ordering for the depth test.
  const Z_SCALE = 1 / 100000;

  // Perspective-carrying transforms (GSAP transformPerspective / authored
  // perspective()) poison drawElementImage even on clip-path-hidden
  // elements: the group's EARLIER DOM siblings drop out of the capture
  // (spikes/de-3d-flat-test.mjs; reproduced on the fast-capture-3d comp —
  // headline missing while footer survived). Read the matrix for the
  // projection, then strip it from the live element. GSAP rewrites its
  // value on every seek so tweened elements stay fresh; static values are
  // served from the cache once stripped.
  const strippedTransforms = new WeakMap<HTMLElement, Mat4>();
  // Any 3D-ness in a live matrix poisons the capture: perspective rows drop
  // earlier siblings, rotation cross terms render wrong, and combined with
  // backface-visibility they reproduce the full bug. The projection only
  // needs the COMPUTED value, so strip live 3D matrices after reading.
  // GSAP rewrites tweened values on every seek (fresh next frame); static
  // stylesheet values are served from the cache once stripped.
  const isThreeDMat4 = (m: Mat4): boolean => {
    const eps = 1e-9;
    return (
      Math.abs(m[2] ?? 0) > eps ||
      Math.abs(m[6] ?? 0) > eps ||
      Math.abs(m[8] ?? 0) > eps ||
      Math.abs(m[9] ?? 0) > eps ||
      Math.abs((m[10] ?? 1) - 1) > eps ||
      Math.abs(m[12] ?? 0) > eps ||
      Math.abs(m[13] ?? 0) > eps ||
      Math.abs(m[14] ?? 0) > eps ||
      Math.abs((m[15] ?? 1) - 1) > eps
    );
  };
  const readTransform = (el: HTMLElement): Mat4 => {
    const value = getComputedStyle(el).transform;
    if (value === "none") {
      return strippedTransforms.get(el) ?? ident();
    }
    const m = parseTransform(value);
    if (isThreeDMat4(m)) {
      strippedTransforms.set(el, m);
      el.style.transform = "none";
    }
    return m;
  };

  const update = (): void => {
    for (const grp of groups) {
      const { gl, prog, pad, canvasW, canvasH } = grp;
      gl.viewport(0, 0, canvasW, canvasH);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);

      // canvas px → clip space, y flipped, z scaled into the clip volume
      const ndc: Mat4 = [
        2 / canvasW,
        0,
        0,
        -1,
        0,
        -2 / canvasH,
        0,
        1,
        0,
        0,
        Z_SCALE,
        0,
        0,
        0,
        0,
        1,
      ];
      // group border-box coords → canvas coords
      const toCanvas = translate(pad, pad);
      let view = mul(ndc, toCanvas);
      // the group's OWN transform (the canvas sits at its untransformed
      // layout box, outside the hidden subtree, so nothing is inherited)
      {
        const gCs = getComputedStyle(grp.rootEl);
        const gT = readTransform(grp.rootEl);
        const [gox, goy, goz] = parseOrigin(gCs.transformOrigin);
        view = mul(view, mul(translate(gox, goy, goz), mul(gT, translate(-gox, -goy, -goz))));
      }
      // perspective applied around the group's perspective-origin
      if (grp.perspective > 0) {
        const [px, py] = grp.perspOrigin;
        view = mul(
          view,
          mul(translate(px, py), mul(perspectiveMat(grp.perspective), translate(-px, -py))),
        );
      }

      const mLoc = gl.getUniformLocation(prog, "m");
      const aLoc = gl.getUniformLocation(prog, "a");
      const pLoc = gl.getAttribLocation(prog, "p");
      const tLoc = gl.getAttribLocation(prog, "t");

      const gAlphaCs = getComputedStyle(grp.rootEl);
      const groupAlpha = Number.parseFloat(gAlphaCs.opacity) || 0;

      for (const quad of grp.quads) {
        // skip invisible quads (autoAlpha visibility inherits down to here)
        const quadCs = getComputedStyle(quad.el);
        if (quadCs.visibility === "hidden" || quadCs.display === "none") continue;
        // compose transform chain + accumulated opacity: group child → quad
        let m = view;
        let alpha = groupAlpha;
        for (let i = 0; i < quad.chain.length; i++) {
          const el = quad.chain[i];
          if (!el) continue;
          const [ox, oy] = quad.offsets[i] ?? [0, 0];
          const elCs = getComputedStyle(el);
          alpha *= Number.parseFloat(elCs.opacity) || 0;
          const t = readTransform(el);
          const [tox, toy, toz] = parseOrigin(elCs.transformOrigin);
          m = mul(
            m,
            mul(
              translate(ox, oy),
              mul(translate(tox, toy, toz), mul(t, translate(-tox, -toy, -toz))),
            ),
          );
        }
        if (alpha <= 0.001) continue;
        gl.uniform1f(aLoc, Math.min(1, alpha));
        if (quad.backfaceHidden) gl.enable(gl.CULL_FACE);
        else gl.disable(gl.CULL_FACE);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad.buf);
        gl.enableVertexAttribArray(pLoc);
        gl.vertexAttribPointer(pLoc, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(tLoc);
        gl.vertexAttribPointer(tLoc, 2, gl.FLOAT, false, 20, 12);
        gl.bindTexture(gl.TEXTURE_2D, quad.tex);
        gl.uniformMatrix4fv(mLoc, false, colMajor(m));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
  };

  (window as Window & { __hf3d?: { update: () => void } }).__hf3d = { update };
  update();

  return {
    ok: true,
    groups: groups.length,
    quads: groups.reduce((n, grp) => n + grp.quads.length, 0),
    selfQuads: selfQuadEls.size,
    stubTargets: ((window as Window & { __hf3dTweenTargets?: unknown[] }).__hf3dTweenTargets ?? [])
      .length,
  };
}

/**
 * Initialize 3D projection on a fast-capture page. Returns the in-page
 * result; on failure the caller should fall back to the baseline route
 * (same contract as the video gate).
 */
export async function initThreeDProjection(page: Page): Promise<ThreeDProjectionResult> {
  try {
    return await page.evaluate(initThreeDProjectionInPage);
  } catch (e) {
    return { ok: false, groups: 0, quads: 0, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Detect CSS effects that drawElementImage cannot reproduce faithfully, so the
 * comp can fall back to screenshot capture instead of rendering damaged frames.
 *
 *  - `backdrop-filter` (blur/etc.) samples the pixels BEHIND the element from
 *    the compositor backdrop. drawElementImage captures the element subtree in
 *    isolation with no backdrop, so the filtered region is wrong (measured
 *    18–49 dB across the community eval). Fundamental single-element-capture
 *    limit, not a tunable bug.
 *  - `filter: blur()` / `filter: drop-shadow()` render differently through the
 *    paint-record path than the full compositor (Chromium inconsistency,
 *    drop-shadow-on-SVG especially; ~29 dB).
 *  - A WebGL context (custom GLSL shader, animated via GSAP uniforms with no
 *    rAF) freezes under seek-based capture: the accel-canvas drawImage
 *    composite captures whatever the GL last drew, which never advances per
 *    seek (~19 dB). The composite reliably handles 2d canvases (sentinel-paint
 *    refresh) but not GL that only redraws on its own loop — so any WebGL
 *    context is treated as a fallback signal here.
 *
 * Scans computed styles under the composition root + the accel-canvas registry.
 * Returns the first matched effect name (for logging) or null.
 */
export async function detectCssEffectRisk(page: Page): Promise<string | null> {
  try {
    // MUST NOT seek the timeline here. Driving `window.__hf.seek` to sample
    // frames renders GSAP `.from()` / overlapping tweens out of forward order and
    // permanently corrupts their lazily-cached start values (GSAP records them on
    // first render). Because this runs BEFORE the gate decision, that corruption
    // then shifts unrelated transformed elements for EVERY comp entering the
    // drawElement branch — DE-routed and screenshot-fallback alike (measured on
    // 1e5a1165: the Pong scene's scale/rotation tween lands wrong, 19.8 dB / 27
    // damaged frames; the fix restored it to baseline parity, 43 dB / 0). So we
    // detect the same effects seek-free, four ways:
    return await page.evaluate(() => {
      const root = document.querySelector("[data-composition-id]");
      if (!root) return null;

      // (1) Computed styles at the current (init/t0) state — effects present in
      // the base render.
      const scanComputed = (): string | null => {
        const els = [root, ...Array.from(root.querySelectorAll("*"))];
        for (const el of els) {
          const cs = getComputedStyle(el as Element) as CSSStyleDeclaration & {
            backdropFilter?: string;
            webkitBackdropFilter?: string;
            mixBlendMode?: string;
          };
          const bf = cs.backdropFilter || cs.webkitBackdropFilter || "";
          if (bf && bf !== "none") return "backdrop-filter";
          const f = cs.filter || "";
          if (f && f !== "none" && f.indexOf("blur(") !== -1) return "filter:blur";
          if (f && f !== "none" && f.indexOf("drop-shadow(") !== -1) return "filter:drop-shadow";
          const mbm = cs.mixBlendMode || "";
          if (mbm && mbm !== "normal") return "mix-blend-mode";
          const an = cs.animationName || "";
          const ad = cs.animationDuration || "0s";
          if (an && an !== "none" && ad !== "0s" && parseFloat(ad) > 0) return "css-animation";
        }
        return null;
      };

      // (2) Stylesheet rules — an effect applied later via a class swap won't be
      // computed at t0, but the rule that declares it exists up front. This
      // replaces the old per-frame scrub scan seek-free (conservative: a declared
      // rule ⇒ gate, even if applied only mid-timeline).
      const scanStyleSheets = (): string | null => {
        for (const sheet of Array.from(document.styleSheets)) {
          let rules: CSSRuleList | null = null;
          try {
            rules = sheet.cssRules;
          } catch {
            continue; // cross-origin sheet — unreadable, skip
          }
          for (const rule of Array.from(rules ?? [])) {
            const txt = (rule as CSSRule).cssText || "";
            if (/backdrop-filter\s*:\s*(?!none)/i.test(txt)) return "backdrop-filter";
            if (/(?:^|[^-])filter\s*:[^;{}]*blur\(/i.test(txt)) return "filter:blur";
            if (/(?:^|[^-])filter\s*:[^;{}]*drop-shadow\(/i.test(txt)) {
              return "filter:drop-shadow";
            }
            if (/mix-blend-mode\s*:\s*(?!normal)/i.test(txt)) return "mix-blend-mode";
          }
        }
        return null;
      };

      // (3) GSAP tween vars — effects animated by GSAP writing inline
      // filter / backdropFilter / mixBlendMode (never present in a stylesheet).
      const scanTweenVars = (): string | null => {
        type AnyTween = {
          vars?: Record<string, unknown>;
          getChildren?: (n: boolean, t: boolean, l: boolean) => AnyTween[];
        };
        const walk = (tl: AnyTween): string | null => {
          if (typeof tl.getChildren !== "function") return null;
          for (const c of tl.getChildren(false, true, true)) {
            const sub = walk(c);
            if (sub) return sub;
            const vars = c.vars || {};
            for (const k of Object.keys(vars)) {
              const kl = k.toLowerCase();
              if (kl.includes("blend")) return "mix-blend-mode";
              if (kl.includes("backdrop")) return "backdrop-filter";
              if (kl === "filter" && /blur\(/i.test(String(vars[k] ?? ""))) return "filter:blur";
              if (kl === "filter" && /drop-shadow\(/i.test(String(vars[k] ?? ""))) {
                return "filter:drop-shadow";
              }
            }
          }
          return null;
        };
        const tls =
          (window as unknown as { __timelines?: Record<string, AnyTween> }).__timelines || {};
        for (const tl of Object.values(tls)) {
          const r = walk(tl);
          if (r) return r;
        }
        return null;
      };

      // (4) WebGL context — seek-invariant, recorded at context creation.
      const scanWebgl = (): string | null => {
        const aw = window as Window & { __hf_accel_canvases?: HTMLCanvasElement[] };
        const accel = (aw.__hf_accel_canvases ?? []).filter((c) => root.contains(c));
        return accel.length > 0 ? "webgl-context" : null;
      };

      return scanComputed() || scanStyleSheets() || scanTweenVars() || scanWebgl();
    });
  } catch {
    return null;
  }
}
