// @vitest-environment happy-dom
/**
 * Button.
 *
 * Whether these classes resolve at all is not asked here. The token gate
 * (`styles/tokenGate.test.ts`) compiles Studio's stylesheet against every class
 * candidate in every source file, so it already covers this one, and a second
 * copy of that check is only a second thing to keep in step. What is left is
 * what the gate cannot see: that the forced preview looks match the real ones,
 * and that the motion token carries its own reduced-motion case.
 *
 * happy-dom has no layout, so nothing here asserts a pixel. What a rendered
 * control looks like is the screenshot script's and the gallery's job.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { compile } from "tailwindcss";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Button, type ButtonVariant } from "./Button";
import { Tab, Tabs, TabsList } from "./Tabs";
import { loadStylesheet, STYLES_DIR } from "../../styles/styleSources";
import { isTypingTarget } from "../../utils/typingTarget";
import { shouldIgnorePlaybackShortcutTarget } from "../../player/lib/playbackShortcuts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "danger", "ghost"];

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

let compileStudioCss: (candidates: string[]) => string;

beforeAll(async () => {
  const compiled = await compile(readFileSync(path.join(STYLES_DIR, "studio.css"), "utf8"), {
    base: STYLES_DIR,
    // Tailwind's loader is declared async; `styleSources` reads from disk
    // synchronously, which is the same answer one turn earlier.
    loadStylesheet: async (id, base) => loadStylesheet(id, base),
  });
  compileStudioCss = (candidates) => compiled.build(candidates);
});

describe("Button classes", () => {
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
