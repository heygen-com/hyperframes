// @vitest-environment happy-dom
/**
 * Button and IconButton.
 *
 * The class-resolution test is the load-bearing one. Tailwind has no strict
 * mode for markup: a class nobody defines is not an error, it is silence, and
 * that is how `rounded-button` and `shadow-btn-primary` sat in this file
 * styling nothing. So the test renders every variant and size, reads the class
 * list off the real DOM node, and compiles Studio's actual stylesheet with
 * those classes as candidates. A class that produces no selector fails, and
 * the failure names it.
 *
 * happy-dom has no layout, so nothing here asserts a pixel. What a rendered
 * control looks like is the screenshot script's job.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { compile } from "tailwindcss";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import { IconButton } from "./IconButton";
import { Tab, Tabs, TabsList } from "./Tabs";
import { isTypingTarget } from "../../utils/typingTarget";
import { shouldIgnorePlaybackShortcutTarget } from "../../player/lib/playbackShortcuts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "danger", "ghost"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

let mounted: { root: Root; host: HTMLElement } | null = null;

function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() => root.render(element));
  return host;
}

afterEach(() => {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

function classesOf(host: HTMLElement, selector = "button"): string[] {
  const el = host.querySelector(selector);
  if (!el) throw new Error(`nothing matched ${selector}`);
  return [...el.classList];
}

// -- the compiled stylesheet, built once for the whole file --

const STYLES_DIR = path.resolve(__dirname, "../../styles");
const require = createRequire(import.meta.url);
const TAILWIND_DIR = path.dirname(require.resolve("tailwindcss/package.json"));

async function loadStylesheet(id: string, base: string) {
  const file = id === "tailwindcss" ? path.join(TAILWIND_DIR, "index.css") : path.resolve(base, id);
  return { path: file, base: path.dirname(file), content: readFileSync(file, "utf8") };
}

/** How Tailwind escapes a candidate into a selector: `\` before each symbol. */
function asSelector(candidate: string): string {
  return candidate.replace(/[^a-zA-Z0-9-]/g, (char) => `\\${char}`);
}

let compileStudioCss: (candidates: string[]) => string;

beforeAll(async () => {
  const compiled = await compile(readFileSync(path.join(STYLES_DIR, "studio.css"), "utf8"), {
    base: STYLES_DIR,
    loadStylesheet,
  });
  compileStudioCss = (candidates) => compiled.build(candidates);
});

function unresolved(candidates: string[]): string[] {
  const css = compileStudioCss(candidates);
  return candidates.filter((candidate) => !css.includes(asSelector(candidate)));
}

describe("Button classes", () => {
  it("emits only classes Studio's stylesheet defines", () => {
    const emitted = new Set<string>();
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const host = render(
          <>
            <Button variant={variant} size={size}>
              Export
            </Button>
            <IconButton variant={variant} size={size} icon={null} aria-label="Zoom out" />
          </>,
        );
        for (const el of host.querySelectorAll("button")) {
          for (const cls of el.classList) emitted.add(cls);
        }
        act(() => mounted?.root.unmount());
        mounted?.host.remove();
        mounted = null;
      }
    }

    expect(emitted.size).toBeGreaterThan(20);
    expect(unresolved([...emitted])).toEqual([]);
  });

  it("fails an undefined class, so the check above is not vacuous", () => {
    expect(unresolved(["rounded-button", "shadow-btn-primary"])).toEqual([
      "rounded-button",
      "shadow-btn-primary",
    ]);
  });

  it("lets a caller's type size beat the size's own", () => {
    // The Renders Export case: `size="md"` brings `text-step-12`, the caller
    // wants 11px, and with plain concatenation both survived into the class
    // list and the stylesheet's order decided the winner.
    const classes = classesOf(render(<Button size="md" className="text-step-11" />));

    expect(classes).toContain("text-step-11");
    expect(classes).not.toContain("text-step-12");
  });

  it("keeps every interactive look reachable without a pointer", () => {
    // `data-preview-state` exists so a gallery can show the hover, active and
    // focus looks. It is worth nothing if it drifts from the real state, so
    // each pair is matched here in both directions.
    const realPrefix = {
      hover: ["enabled:hover:", "hover:"],
      active: ["enabled:active:", "active:"],
      focus: ["focus-visible:"],
    };

    for (const variant of VARIANTS) {
      const classes = classesOf(render(<Button variant={variant}>Export</Button>));
      act(() => mounted?.root.unmount());
      mounted?.host.remove();
      mounted = null;

      for (const [state, prefixes] of Object.entries(realPrefix)) {
        const previewPrefix = `data-[preview-state=${state}]:`;
        const preview = classes
          .filter((cls) => cls.startsWith(previewPrefix))
          .map((cls) => cls.slice(previewPrefix.length));
        const real = classes
          .filter((cls) => prefixes.some((prefix) => cls.startsWith(prefix)))
          .map((cls) => cls.slice(cls.lastIndexOf(":") + 1));

        expect([...preview].sort(), `${variant} ${state}`).toEqual([...real].sort());
        expect(preview.length, `${variant} ${state}`).toBeGreaterThan(0);
      }
    }
  });

  it("uses a motion token that zeroes itself under reduced motion", () => {
    // AE4. The zero-duration case lives in the `duration-press` utility itself
    // (theme.css), not in a `motion-reduce:` class beside it, so a caller
    // cannot use the token and forget the reduced-motion half. The button's
    // job is to name the token; the stylesheet's job is the media query.
    expect(classesOf(render(<Button>Export</Button>))).toContain("duration-press");

    expect(compileStudioCss(["duration-press"])).toMatch(
      /\.duration-press \{[\s\S]*?prefers-reduced-motion: reduce[\s\S]*?transition-duration: 0ms/,
    );
  });
});

describe("Button behaviour", () => {
  it("does not fire a disabled click, and says it is disabled", () => {
    let clicks = 0;
    const host = render(
      <Button disabled onClick={() => (clicks += 1)}>
        Export
      </Button>,
    );
    const button = host.querySelector("button")!;

    act(() => button.click());

    expect(clicks).toBe(0);
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("still fires a click while a preview state is forced", () => {
    let clicks = 0;
    const host = render(
      <Button data-preview-state="hover" onClick={() => (clicks += 1)}>
        Export
      </Button>,
    );
    const button = host.querySelector("button")!;

    act(() => button.click());

    expect(clicks).toBe(1);
    expect(button.getAttribute("data-preview-state")).toBe("hover");
  });

  it("is classified by the hotkey selectors the way a plain button is", () => {
    // KTD13. Both selector lists gate on roles and element names. A primitive
    // that landed on a different role would leak or swallow global hotkeys with
    // nothing to notice it.
    const host = render(
      <>
        <button type="button" data-testid="plain">
          Export
        </button>
        <Button data-testid="primitive">Export</Button>
        <Tabs defaultValue="code">
          <TabsList aria-label="Sidebar panels">
            <Tab value="code">Code</Tab>
          </TabsList>
        </Tabs>
      </>,
    );
    const plain = host.querySelector('[data-testid="plain"]')!;
    const button = host.querySelector('[data-testid="primitive"]')!;
    const tab = host.querySelector('[role="tab"]')!;

    for (const el of [plain, button, tab]) {
      expect(isTypingTarget(el)).toBe(false);
      expect(shouldIgnorePlaybackShortcutTarget(el)).toBe(true);
    }
  });
});
