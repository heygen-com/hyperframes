// A sealed preview driven by a sequence of saves, replies and reloads, then compared with a fresh load of the
// saved file. A fixture says what a save changes, how Studio sends it, and what a viewer sees.
import type { Browser, Frame, Page } from "puppeteer-core";
import { openPreview, type Studio } from "./sealedPreviewHarness";

/** A save reaches the frame, is refused by it, or is rejected by the port before the frame applies anything. */
export type SaveFate = "frame" | "refused" | "rejected" | "never";

export type SequenceStep<Save extends string> =
  | { save: Save; fate: SaveFate }
  | { answer: "any" | "oldest" | "newest" | string }
  | { scrub: number }
  /** Two saves whose responses come back newest first, so the older one's preview sync goes out last. */
  | { reversed: [Save, Save]; reload?: true }
  /** The oldest request deadline still pending passes; a reply after it arrives too late. */
  | { pastDeadline: true }
  | { reloadFrame: true };

export interface SequenceFixture<Saved, Save extends string> {
  first: Saved;
  /** The saved file as the preview loads it. */
  page(saved: Saved): string;
  next: Record<Save, (saved: Saved, step: number) => Saved>;
  /** Marks a save's write request as Studio does when it goes out; resolves to the file revision it took. */
  mark(studioPage: Page): Promise<number>;
  /** Sends `save` the way Studio does after writing the file; `window.__reload` is Studio's full reload. */
  send(
    studioPage: Page,
    save: Save,
    before: Saved,
    after: Saved,
    revision: number,
  ): Promise<unknown>;
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
export async function openStudio(
  browser: Browser,
  bundle: string,
  first: string,
  at: number,
  mode = "sealed",
) {
  const preview = await openPreview(browser, bundle, first, mode);
  await preview.release(200);
  await scrub(preview.page, preview.frame, at);
  await preview.page.evaluate((first) => {
    const w = window as unknown as {
      __hold: boolean;
      __saved: string;
      __reloads: number;
      __reload: () => void;
      __load: () => void;
      __loading: boolean;
      __refusals: number;
    };
    w.__hold = true;
    w.__saved = first;
    w.__reloads = 0;
    // As Studio's shadow reload (useShadowPreviewReload.ts): a save during the load loads the newer file again.
    const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
    w.__load = () => {
      const iframe = document.querySelector("iframe")!;
      const content = w.__saved;
      const revision = studio.studioFileRevision();
      w.__loading = true;
      iframe.addEventListener(
        "load",
        () => {
          if (w.__saved !== content) return w.__load();
          studio.previewLoadShows(iframe, revision);
          w.__loading = false;
        },
        { once: true },
      );
      iframe.srcdoc = content;
    };
    w.__loading = false;
    w.__reload = () => {
      w.__reloads++;
      w.__load();
    };
    // A deadline (4 s or more) fires only when a step or the drain says it passes, never on its own.
    const deadlines = new Map<number, () => void>();
    let nextDeadline = -1;
    const set = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    window.setTimeout = ((
      handler: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (typeof ms !== "number" || ms < 4_000) return set(handler, ms, ...args);
      const id = nextDeadline--;
      deadlines.set(id, () => handler(...args));
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id === undefined || !deadlines.delete(id)) clear(id);
    }) as typeof window.clearTimeout;
    (window as unknown as { __passDeadlines: (all: boolean) => number }).__passDeadlines = (
      all,
    ) => {
      const due = all ? [...deadlines.keys()] : [...deadlines.keys()].slice(0, 1);
      for (const id of due) {
        const fire = deadlines.get(id)!;
        deadlines.delete(id);
        // A missed reply may leave nothing to recover in place.
        w.__refusals++;
        fire();
      }
      return due.length;
    };
    // A new load is shown at Studio's playhead, as the real preview's shadow reload shows it.
    window.addEventListener("message", (event) => {
      const iframe = document.querySelector("iframe")!;
      const data = event.data as { source?: string; type?: string } | null;
      if (
        event.source !== iframe.contentWindow ||
        data?.source !== "hf-preview" ||
        data.type !== "ready"
      )
        return;
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const timeSeconds = studio.usePlayerStore.getState().currentTime;
      iframe.contentWindow!.postMessage(
        { source: "hf-parent", type: "control", action: "seek", timeSeconds },
        "*",
      );
    });
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
export function answer(studioPage: Page, pick: number, kind: string | null) {
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

/** Where the preview's playhead is, and where Studio thinks it is, once a pending seek has had time to land. */
const playheads = async (studioPage: Page, frame: Frame) => {
  const studio = await studioPage.evaluate(
    () =>
      (window as unknown as { hfStudio: Studio }).hfStudio.usePlayerStore.getState().currentTime,
  );
  await frame
    .waitForFunction(
      (t) =>
        Math.abs(
          (window as unknown as { __player: { getTime(): number } }).__player.getTime() - t,
        ) <
        1 / 30,
      { timeout: 1_000 },
      studio,
    )
    .catch(() => {});
  return readPlayheads(studioPage, frame);
};

const readPlayheads = (studioPage: Page, frame: Frame) =>
  Promise.all([
    frame.evaluate(() =>
      (window as unknown as { __player: { getTime(): number } }).__player.getTime(),
    ),
    studioPage.evaluate(
      () =>
        (window as unknown as { hfStudio: Studio }).hfStudio.usePlayerStore.getState().currentTime,
    ),
  ]).then(([shown, studio]) => ({ shown, studio }));

/** Sends one save with its fate, and waits until Studio has posted its request or reloaded. */
async function sendSave<Saved, Save extends string>(
  studioPage: Page,
  fixture: SequenceFixture<Saved, Save>,
  save: Save,
  fate: SaveFate,
  [before, after]: [Saved, Saved],
  revision: number,
) {
  await studioPage.evaluate(
    (fate, kinds) => {
      const w = window as unknown as {
        __swallow: Set<string>;
        __rejecting: boolean;
        __neverAnswer: boolean;
      };
      w.__swallow = new Set(fate === "frame" ? [] : kinds);
      w.__rejecting = fate === "rejected";
      w.__neverAnswer = fate === "never";
    },
    fate,
    SAVE_KINDS,
  );
  const sent = () =>
    studioPage.evaluate(() => {
      const w = window as unknown as { __posted: number; __reloads: number };
      return w.__posted + w.__reloads;
    });
  const count = await sent();
  await fixture.send(studioPage, save, before, after, revision);
  // Studio posts the request a tick later, or reloads when nothing can apply in place; its fate holds until then.
  await studioPage.waitForFunction(
    (n) => {
      const w = window as unknown as { __posted: number; __reloads: number };
      return w.__posted + w.__reloads > n;
    },
    {},
    count,
  );
  await studioPage.evaluate(() => {
    (window as unknown as { __swallow: Set<string> }).__swallow = new Set();
  });
}

/** Waits until a reload in flight has shown the newest saved file. */
export async function loaded(studioPage: Page, frame: Frame) {
  await studioPage.waitForFunction(() => !(window as unknown as { __loading: boolean }).__loading);
  await ready(frame);
}

export const passDeadlines = (studioPage: Page, all: boolean) =>
  studioPage.evaluate(
    (every) =>
      (window as unknown as { __passDeadlines: (all: boolean) => number }).__passDeadlines(every),
    all,
  );

/**
 * Answers everything still pending, new recoveries included, until nothing is left and the frame is loaded; then
 * every deadline still pending passes, and it drains again.
 */
export async function drain(studioPage: Page, frame: Frame, random: () => number) {
  await studioPage.evaluate(() => {
    (window as unknown as { __swallow: Set<string> }).__swallow = new Set();
  });
  for (let quiet = 0; quiet < 3; ) {
    await loaded(studioPage, frame);
    await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    const left = await pending(studioPage);
    if (left.length === 0 && quiet === 2 && (await passDeadlines(studioPage, true)) > 0) quiet = 0;
    else if (left.length === 0) quiet++;
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
/** Two saves whose responses come back newest first: the newer's sync goes out, then the older's. */
async function playReversed<Saved, Save extends string>(
  studioPage: Page,
  frame: Frame,
  fixture: SequenceFixture<Saved, Save>,
  step: { reversed: [Save, Save]; reload?: true },
  [saved, n]: [Saved, number],
) {
  const [older, newer] = step.reversed;
  const middle = fixture.next[older](saved, n);
  const after = fixture.next[newer](middle, n);
  const olderRevision = await fixture.mark(studioPage);
  const newerRevision = await fixture.mark(studioPage);
  await sendSave(studioPage, fixture, newer, "frame", [middle, after], newerRevision);
  // The frame loads the newer saved file before the older sync goes out.
  if (step.reload) {
    await studioPage.evaluate(() => (window as unknown as { __load: () => void }).__load());
    await loaded(studioPage, frame);
  }
  const reloads = () =>
    studioPage.evaluate(() => (window as unknown as { __reloads: number }).__reloads);
  const before = await reloads();
  await sendSave(studioPage, fixture, older, "frame", [saved, middle], olderRevision);
  // Studio does not send the older write over the newer file; a reload there is that refusal.
  if ((await reloads()) > before)
    await studioPage.evaluate(() => (window as unknown as { __refusals: number }).__refusals++);
}

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
      const revision = await fixture.mark(studioPage);
      await sendSave(studioPage, fixture, step.save, step.fate, [saved, after], revision);
      saved = after;
    } else if ("reversed" in step) {
      await playReversed(studioPage, frame, fixture, step, [saved, n]);
      saved = fixture.next[step.reversed[1]](fixture.next[step.reversed[0]](saved, n), n);
    } else if ("pastDeadline" in step) {
      await passDeadlines(studioPage, false);
    } else if ("scrub" in step) {
      await scrub(studioPage, frame, step.scrub);
    } else if ("reloadFrame" in step) {
      await studioPage.evaluate(() => (window as unknown as { __load: () => void }).__load());
      await loaded(studioPage, frame);
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
