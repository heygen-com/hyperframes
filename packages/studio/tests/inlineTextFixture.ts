// Generated sequences of inline text edits and Design panel text saves against a sealed and an unsealed preview,
// with the frame's replies held, writes that fail or wait, and frame reloads. See inlineTextGenerated.browser.test.ts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser, Frame, Page } from "puppeteer-core";
import { openPreview } from "./sealedPreviewHarness";
import { answer, drain, loaded, openStudio, passDeadlines } from "./sealedPreviewSequence";
import type { TextEditing, WriteFate } from "./inlineTextMount";

const require = createRequire(import.meta.url);
const GSAP = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
const RUNTIME = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
const MARK = '<meta name="hyperframes-studio-preview" content="1" />';

const ORIGINAL = '<span data-hf-id="a">One</span> <span data-hf-id="b">Two</span>';
const TYPED = ["Uno", "Dos", "Tres"];
const PANEL = ["Red", "Blue"];
const WORDS = new Set(["One", "Two", "New", "text", ...TYPED, ...PANEL]);

const root = (markup: string) =>
  `<div id="root" data-hf-id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">` +
  `<h1 id="t" data-hf-id="t" class="clip" data-start="0" data-duration="4" data-track-index="1">${markup}</h1></div>`;
const TIMELINE = `window.__timelines = window.__timelines || {};
  window.__timelines["main"] = gsap.timeline({ paused: true }).to("#t", { opacity: 1, duration: 4 }, 0);`;
/** The saved file as Studio reads it. */
const file = (markup: string) => `<html><body>${root(markup)}</body></html>`;
/** The saved file as the preview loads it. */
const page = (markup: string) =>
  `<!doctype html><html><head><meta charset="UTF-8" />${MARK}</head><body>${root(markup)}` +
  `<script>${GSAP}</script><script>${TIMELINE}</script><script>${RUNTIME}</script></body></html>`;

export type Step =
  | { open: true }
  | { type: { field: 0 | 1; text: string } }
  | { end: "save" | "blur" }
  | { cancel: true }
  | { panel: "text"; field: 0 | 1; value: string }
  | { panel: "add" }
  | { panel: "remove"; field: 0 | 1 }
  | { answer: true }
  | { release: true }
  | { reloadFrame: true }
  | { pastDeadline: true };

const isGesture = (step: Step) =>
  "open" in step || "type" in step || "end" in step || "cancel" in step || "panel" in step;
/** Steps that only move when replies and writes arrive; the one-at-a-time model leaves them out. */
const isTiming = (step: Step) => "answer" in step || "release" in step || "pastDeadline" in step;

type Draw = { random: () => number; pick: <T>(list: readonly T[]) => T };

const editStep = (open: boolean, roll: number, { random, pick }: Draw): Step | null => {
  if (open && roll < 0.3) return { type: { field: pick([0, 1] as const), text: pick(TYPED) } };
  if (open && roll < 0.4)
    return random() < 0.15 ? { cancel: true } : { end: pick(["save", "blur"] as const) };
  return !open && roll < 0.3 ? { open: true } : null;
};

const panelStep = ({ pick }: Draw): Step => {
  const kind = pick(["text", "text", "add", "remove"] as const);
  if (kind === "text") return { panel: "text", field: pick([0, 1] as const), value: pick(PANEL) };
  return kind === "add" ? { panel: "add" } : { panel: "remove", field: pick([0, 1] as const) };
};

const timingStep = (roll: number): Step => {
  if (roll < 0.8) return { answer: true };
  if (roll < 0.87) return { release: true };
  return roll < 0.93 ? { pastDeadline: true } : { reloadFrame: true };
};

/** A seeded sequence a person could make: typing only into an open edit, a panel save ending one that is open. */
export function generated(seed: number): Step[] {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const draw: Draw = { random, pick: (list) => list[Math.floor(random() * list.length)]! };
  const steps: Step[] = [];
  let open = false;
  while (steps.length < 10) {
    const roll = random();
    const step = editStep(open, roll, draw) ?? (roll < 0.5 ? panelStep(draw) : timingStep(roll));
    steps.push(step);
    if ("open" in step) open = true;
    else if ("end" in step || "cancel" in step || "panel" in step) open = false;
  }
  // The person finishes: an edit still open at the end is saved.
  if (open) steps.push({ end: "save" });
  return steps;
}

/** Each write's fate by the order writes reach the file, so both modes fail the same writes: even seeds all land. */
/** A frame reply held past its deadline: a sealed-only fault, so the file may differ from unsealed's. */
export const passesDeadline = (steps: Step[]) => steps.some((step) => "pastDeadline" in step);

export function writeFates(seed: number): WriteFate[] {
  if (seed % 2 === 0) return [];
  let state = seed * 7919;
  const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  return Array.from(
    { length: 6 },
    () => (["land", "fail", "wait"] as const)[Math.floor(random() * 3)]!,
  );
}

type Editing = {
  hfStudio: { mountTextEditing: (...args: unknown[]) => TextEditing };
  __text: TextEditing;
};

/** Every text field's words came from the original or from a gesture, never invented or spliced. */
export function wordsFromGestures(markup: string): boolean {
  const text = markup.replace(/<[^>]*>/g, " ");
  return text.split(/\s+/).every((word) => word === "" || WORDS.has(word));
}

/** The element's markup as a viewer sees it, editing marks dropped and each style's declarations in one order. */
const shown = (frame: Frame) =>
  frame.evaluate(() => {
    const copy = document.getElementById("t")!.cloneNode(true) as HTMLElement;
    for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
      for (const name of [...el.getAttributeNames()])
        if (/^data-hf-|^contenteditable$|^spellcheck$/.test(name)) el.removeAttribute(name);
      const style = el.getAttribute("style");
      if (style)
        el.setAttribute(
          "style",
          style
            .split(";")
            .map((d) => d.trim())
            .filter(Boolean)
            .sort()
            .join("; "),
        );
    }
    return copy.innerHTML;
  });

/** Runs a user-side action with the frame's replies flowing, as a click or key press would. */
async function unheld(studioPage: Page, run: () => Promise<unknown>) {
  await studioPage.evaluate(() => ((window as unknown as { __hold: boolean }).__hold = false));
  try {
    await run();
  } finally {
    await studioPage.evaluate(() => ((window as unknown as { __hold: boolean }).__hold = true));
  }
}

async function gesture(studioPage: Page, frame: Frame, step: Step, random: () => number) {
  // A person types once the caret shows: an edit still opening waits for what it waits on.
  if ("type" in step && (await opening(studioPage, frame))) await settle(studioPage, frame, random);
  if ("type" in step)
    return frame.evaluate(({ field, text }) => {
      // Keys reach only an element in an edit.
      const span = document.getElementById("t")!.querySelectorAll("span")[field];
      if (span?.isContentEditable) span.textContent = text;
    }, step.type);
  if ("end" in step && step.end === "blur")
    return frame.evaluate(() =>
      document.getElementById("t")!.dispatchEvent(new FocusEvent("blur")),
    );
  // A person clicks a frame that shows: a reload in flight lands first.
  await loaded(studioPage, frame);
  // The person's click selects with the frame answering; the edit's own requests then wait on the test.
  await unheld(studioPage, () =>
    studioPage.evaluate(async () => {
      const w = window as unknown as Editing & { __selection: unknown };
      w.__selection = await w.__text.select().catch(() => null);
    }),
  );
  return studioPage.evaluate(
    (s) => {
      const w = window as unknown as Editing & {
        __selection: import("../src/components/editor/domEditing").DomEditSelection | null;
      };
      const text = w.__text;
      const selection = w.__selection;
      if (!selection) return;
      const field = (i: number) => selection.textFields[i]?.key;
      if ("open" in s) return void text.controls().start(selection.element);
      if ("end" in s) return void text.controls().commit();
      if ("cancel" in s) return void text.controls().cancel();
      // The panel shows only the fields the element has.
      if (s.panel === "text") {
        const shown = field(s.field);
        return void (
          shown && text.commits().handleDomTextCommitForSelection(selection, s.value, shown)
        );
      }
      if (s.panel === "add") return void text.commits().handleDomAddTextField(field(1));
      const key = field(s.field);
      if (key) void text.commits().handleDomRemoveTextField(key);
    },
    step as Exclude<Step, { type: unknown }>,
  );
}

const opening = async (studioPage: Page, frame: Frame) =>
  (await loaded(studioPage, frame)) === undefined &&
  !(await frame.evaluate(() => document.getElementById("t")!.isContentEditable)) &&
  (await studioPage.evaluate(
    () => (window as unknown as Editing).__text.controls().session !== null,
  ));

/** Answers, releases and passes deadlines until nothing is pending and the frame shows its last load. */
async function settle(studioPage: Page, frame: Frame, random: () => number) {
  for (let quiet = 0; quiet < 2; ) {
    await drain(studioPage, frame, random);
    const busy = await studioPage.evaluate(() => {
      const text = (window as unknown as Editing).__text;
      const waiting = text.waiting();
      text.releaseWaiting();
      return waiting > 0 || text.pending();
    });
    quiet = busy ? 0 : quiet + 1;
    // What the released writes start (a held request, a write that waits) goes round the loop again.
    if (busy)
      await studioPage.waitForFunction(() => {
        const w = window as unknown as Editing & { __held: unknown[] };
        return !w.__text.pending() || w.__held.length > 0 || w.__text.waiting() > 0;
      });
  }
}

/** Plays `steps` in `mode`; `serial` settles after every step and lands every write (the model). */
export async function playText(
  browser: Browser,
  bundle: string,
  steps: Step[],
  { mode, seed, serial }: { mode: "sealed" | "unsealed"; seed: number; serial: boolean },
) {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const preview = await openStudio(browser, bundle, page(ORIGINAL), 2, mode);
  const { page: studioPage, frame } = preview;
  await studioPage.evaluate(
    (sealed, saved) => {
      const w = window as unknown as Editing;
      const page = window as unknown as { __saved: string };
      const landed = (markup: string) =>
        (page.__saved = page.__saved.replace(
          /(<h1 id="t"[^>]*>)[\s\S]*?(<\/h1>)/,
          (_, a, b) => a + markup + b,
        ));
      w.__text = w.hfStudio.mountTextEditing(
        document.querySelector("iframe"),
        sealed,
        saved,
        "t",
        landed,
      );
    },
    mode === "sealed",
    file(ORIGINAL),
  );
  if (!serial)
    await studioPage.evaluate(
      (fates) => void (window as unknown as Editing).__text.fates.push(...fates),
      writeFates(seed),
    );
  for (const step of steps) {
    if (serial && isTiming(step)) continue;
    if (isGesture(step)) await gesture(studioPage, frame, step, random);
    else if ("answer" in step) await answer(studioPage, Math.floor(random() * 1000), null);
    else if ("release" in step)
      await studioPage.evaluate(() => (window as unknown as Editing).__text.releaseWaiting());
    else if ("pastDeadline" in step) await passDeadlines(studioPage, false);
    else {
      await studioPage.evaluate(() => {
        const w = window as unknown as Editing & { __load: () => void };
        w.__text.reloadWhenFree(() => w.__load());
      });
      await loaded(studioPage, frame);
    }
    if (serial) await settle(studioPage, frame, random);
  }
  await settle(studioPage, frame, random);
  const result = await studioPage.evaluate(() => {
    const text = (window as unknown as Editing).__text;
    return {
      saved: text.saved().replace(/ data-hf-[a-z-]+="[^"]*"/g, ""),
      writes: text.writes,
      skipped: text.skipped,
      reported: text.reported,
    };
  });
  const canvas = await shown(frame);
  await studioPage.close();
  const fresh = await openPreview(browser, bundle, page(result.saved), mode);
  await fresh.frame.waitForFunction(() => document.getElementById("t") !== null);
  const freshCanvas = await shown(fresh.frame);
  await fresh.page.close();
  return { ...result, canvas, freshCanvas };
}
