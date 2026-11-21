// A sealed preview driven by a sequence of saves, replies and reloads, then compared with a fresh load of the
// saved file. A fixture says what a save changes, how Studio sends it, and what a viewer sees.
import type { Browser, Frame, Page } from "puppeteer-core";
import { openPreview, type Studio } from "./sealedPreviewHarness";

/** A save reaches the frame, is refused by it, or is rejected by the port before the frame applies anything. */
export type SaveFate = "frame" | "refused" | "rejected";

export type SequenceStep<Save extends string> =
  | { save: Save; fate: SaveFate }
  | { answer: "any" | "oldest" | "newest" | string }
  | { scrub: number }
  | { reloadFrame: true };

export interface SequenceFixture<Saved, Save extends string> {
  first: Saved;
  /** The saved file as the preview loads it. */
  page(saved: Saved): string;
  next: Record<Save, (saved: Saved, step: number) => Saved>;
  /** Sends `save` the way Studio does after writing the file; `window.__reload` is Studio's full reload. */
  send(studioPage: Page, save: Save, before: Saved, after: Saved): Promise<unknown>;
  /** What a viewer sees, read once the preview has been sought to `at` seconds. */
  read(frame: Frame): Promise<unknown>;
  at: number;
}

/** The refusal a frame that never took the request would send, by request kind. */
const REFUSAL: Record<string, unknown> = {
  "soft-reload": { result: "cannot-soft-reload" },
  "patch-tweens": { patched: false },
  "restore-attributes": { applied: false, reran: false },
  "live-retime": { result: "unchanged" },
};

const SAVE_KINDS = ["soft-reload", "patch-tweens", "restore-attributes", "live-retime"];

const ready = (frame: Frame) =>
  frame.waitForFunction(() => "__player" in window && "__timelines" in window);

/** Seeks the `index`th frame of `studioPage` to `at` and waits for the render. */
async function seekTo(studioPage: Page, frame: Frame, index: number, at: number) {
  await studioPage.evaluate(
    (i, t) => {
      document
        .querySelectorAll("iframe")
        [i]!.contentWindow!.postMessage(
          { source: "hf-parent", type: "control", action: "seek", timeSeconds: t },
          "*",
        );
    },
    index,
    at,
  );
  await frame.waitForFunction(
    (t) =>
      Math.abs((window as unknown as { __player: { getTime(): number } }).__player.getTime() - t) <
      0.01,
    {},
    at,
  );
  await frame.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Studio's page: every reply held until answered; a full reload loads the newest saved file and is counted. */
async function openStudio(browser: Browser, bundle: string, first: string, at: number) {
  const preview = await openPreview(browser, bundle, first, "sealed");
  await preview.release(200);
  await scrub(preview.page, preview.frame, at);
  await preview.page.evaluate((first) => {
    const w = window as unknown as {
      __hold: boolean;
      __saved: string;
      __reloads: number;
      __reload: () => void;
    };
    w.__hold = true;
    w.__saved = first;
    w.__reloads = 0;
    w.__reload = () => {
      w.__reloads++;
      document.querySelector("iframe")!.srcdoc = w.__saved;
    };
  }, first);
  return preview;
}

type Pending = { kind: string; refused: boolean };

const pending = (studioPage: Page) =>
  studioPage.evaluate(() => {
    const w = window as unknown as {
      __held: unknown[];
      __heldKinds?: string[];
      __swallowed: Array<{ kind: string }>;
    };
    return [
      ...w.__held.map(() => ({ kind: "reply", refused: false })),
      ...w.__swallowed.map(({ kind }) => ({ kind, refused: true })),
    ] as Pending[];
  });

/** Answers one pending request: a held reply as the frame sent it, or a refused one with its refusal. */
function answer(studioPage: Page, pick: number, kind: string | null) {
  return studioPage.evaluate(
    (at, wanted, refusals) => {
      const w = window as unknown as {
        __held: Array<() => void>;
        __swallowed: Array<{ kind: string; answer: (result: unknown) => void }>;
      };
      const refuse = (entry: { kind: string; answer: (result: unknown) => void }) =>
        entry.answer(refusals[entry.kind]);
      if (wanted === "oldest") return w.__held.shift()?.();
      if (wanted === "newest") return w.__held.pop()?.();
      const refusedAt = wanted ? w.__swallowed.findIndex((entry) => entry.kind === wanted) : -1;
      if (refusedAt >= 0) return refuse(w.__swallowed.splice(refusedAt, 1)[0]!);
      const all = w.__held.length + w.__swallowed.length;
      if (all === 0) return;
      const i = at % all;
      if (i < w.__held.length) return w.__held.splice(i, 1)[0]!();
      refuse(w.__swallowed.splice(i - w.__held.length, 1)[0]!);
    },
    pick,
    kind,
    REFUSAL,
  );
}

/** Moves Studio's playhead to `at`, as a scrub does: the player store and the frame together. */
async function scrub(studioPage: Page, frame: Frame, at: number) {
  await studioPage.evaluate((t) => {
    const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
    studio.usePlayerStore.getState().setCurrentTime(t);
  }, at);
  await seekTo(studioPage, frame, 0, at);
}

/** Where the preview's playhead is, and where Studio thinks it is. */
const playheads = (studioPage: Page, frame: Frame) =>
  Promise.all([
    frame.evaluate(() =>
      (window as unknown as { __player: { getTime(): number } }).__player.getTime(),
    ),
    studioPage.evaluate(
      () =>
        (window as unknown as { hfStudio: Studio }).hfStudio.usePlayerStore.getState().currentTime,
    ),
  ]).then(([shown, studio]) => ({ shown, studio }));

/** Answers everything still pending, new recoveries included, until nothing is left and the frame is loaded. */
async function drain(studioPage: Page, frame: Frame, random: () => number) {
  await studioPage.evaluate(() => {
    (window as unknown as { __swallow: Set<string> }).__swallow = new Set();
  });
  for (let quiet = 0; quiet < 3; ) {
    await ready(frame);
    await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    const left = await pending(studioPage);
    if (left.length === 0) quiet++;
    else {
      quiet = 0;
      await answer(studioPage, Math.floor(random() * 1000), null);
    }
  }
}

/** A fresh load of `saved` in a page of its own. */
async function freshLoad<Saved, Save extends string>(
  browser: Browser,
  bundle: string,
  fixture: SequenceFixture<Saved, Save>,
  saved: Saved,
) {
  const fresh = await openPreview(browser, bundle, fixture.page(saved), "sealed");
  await ready(fresh.frame);
  await seekTo(fresh.page, fresh.frame, 0, fixture.at);
  const shown = await fixture.read(fresh.frame);
  await fresh.page.close();
  return shown;
}

/** Plays `steps`, settles every reply, and compares the preview with a fresh load of the saved file. */
export async function playSequence<Saved, Save extends string>(
  browser: Browser,
  bundle: string,
  fixture: SequenceFixture<Saved, Save>,
  steps: SequenceStep<Save>[],
  seed = 1,
) {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const preview = await openStudio(browser, bundle, fixture.page(fixture.first), fixture.at);
  const { page: studioPage, frame } = preview;
  let saved = fixture.first;
  for (const [n, step] of steps.entries()) {
    if ("save" in step) {
      const after = fixture.next[step.save](saved, n);
      await studioPage.evaluate(
        (fate, kinds) => {
          const w = window as unknown as { __swallow: Set<string>; __rejecting: boolean };
          w.__swallow = new Set(fate === "frame" ? [] : kinds);
          w.__rejecting = fate === "rejected";
        },
        step.fate,
        SAVE_KINDS,
      );
      const posted = () =>
        studioPage.evaluate(() => (window as unknown as { __posted: number }).__posted);
      const before = await posted();
      await fixture.send(studioPage, step.save, saved, after);
      // Studio posts the request a tick later; its fate holds until it has gone out.
      await studioPage.waitForFunction(
        (n) => (window as unknown as { __posted: number }).__posted > n,
        {},
        before,
      );
      await studioPage.evaluate(() => {
        (window as unknown as { __swallow: Set<string> }).__swallow = new Set();
      });
      saved = after;
    } else if ("scrub" in step) {
      await scrub(studioPage, frame, step.scrub);
    } else if ("reloadFrame" in step) {
      await studioPage.evaluate(() => {
        const w = window as unknown as { __saved: string };
        document.querySelector("iframe")!.srcdoc = w.__saved;
      });
      await ready(frame);
    } else {
      const kind = step.answer === "any" ? null : step.answer;
      await answer(studioPage, Math.floor(random() * 1000), kind);
    }
  }
  await drain(studioPage, frame, random);
  const playhead = await playheads(studioPage, frame);
  await seekTo(studioPage, frame, 0, fixture.at);
  const shown = await fixture.read(frame);
  const { reloads, reloadRefusals } = await studioPage.evaluate(() => {
    const w = window as unknown as { __reloads: number; __refusals: number };
    return { reloads: w.__reloads, reloadRefusals: w.__refusals };
  });
  await studioPage.close();
  const fresh = await freshLoad(browser, bundle, fixture, saved);
  return { shown, fresh, reloads, reloadRefusals, playhead };
}
