// Real Chrome, sealed preview: Studio's saves (script re-runs, tween patches, retimes, undos) reach the frame or are
// refused, their replies arrive in any order, and the frame may reload. Once every reply has settled, the preview
// must equal a fresh load of the saved file, with a full reload only after a refusal nothing can recover in place.
// The reviewer's sequences and the pinned seeds; sealedPreviewOrderingGenerated.browser.test.ts runs fresh seeds.
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { expectGenerated, playOrdering, type Step } from "../../tests/sealedOrderingFixture";
import { buildStudioBundle } from "../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle();
});
afterAll(() => closeTestChrome(browser));
const play = (steps: Step[], seed = 1, two = false) =>
  playOrdering(browser, studioBundle, steps, seed, two);

// The reviewer's sequences: the first and third are red without the fix; the second guards its class.
type Fixed = [string, Step[], { seed?: number; two?: boolean }?];
const SEEDS: Fixed[] = [
  [
    "an undo of a script and a title the frame refuses, held past a newer script-only run",
    [
      { save: "undoBoth", fate: "frame" },
      { save: "run", fate: "frame" },
      { answer: "newest" },
      { answer: "oldest" },
    ],
  ],
  [
    // A guard, not the reviewer's sequence: his retime went through live-retime, which this harness does not
    // send (sealedPreviewLedger.test.ts reproduces it); seed 28 reproduces the lost data-start here.
    "a refused patch, then a refused retime re-run, then the patch's refusal",
    [
      { save: "patch", fate: "refused" },
      { save: "retime", fate: "refused" },
      { answer: "patch-tweens" },
    ],
  ],
  [
    "a refused patch, then a static undo, then the patch's refusal",
    [
      { save: "patch", fate: "refused" },
      { save: "undoLabel", fate: "frame" },
      { answer: "any" },
      { answer: "patch-tweens" },
    ],
  ],
  // The reviewer's round-8 probes, as written.
  [
    "a refused patch, a live retime whose refusal is pending and a static undo, then the patch's refusal",
    [
      { save: "patch", fate: "refused" },
      { save: "liveRetime", fate: "refused" },
      { save: "undoLabel", fate: "frame" },
      { answer: "patch-tweens" },
    ],
  ],
  [
    "a refused live retime, then a script-only run, then the retime's refusal",
    [
      { save: "liveRetime", fate: "refused" },
      { save: "run", fate: "frame" },
      { answer: "newest" },
      { answer: "live-retime" },
    ],
  ],
  [
    "a refused live retime at 2 s, a newer run, a scrub to 4 s, then the retime's refusal",
    [
      { save: "liveRetime", fate: "refused" },
      { save: "run", fate: "frame" },
      { answer: "newest" },
      { scrub: 4 },
      { answer: "live-retime" },
    ],
  ],
  [
    "a retime the port rejects before applying, answered after a newer script-only run painted",
    [
      { save: "retime", fate: "rejected" },
      { save: "run", fate: "frame" },
      { answer: "newest" },
      { answer: "soft-reload" },
    ],
  ],
  // The reviewer's round-9 probes, as written.
  [
    "two scripts: a refused patch, then an undo of data-start applied, then the patch's refusal",
    [
      { save: "patch", fate: "refused" },
      { save: "undoStart", fate: "frame" },
      { answer: "oldest" },
      { answer: "patch-tweens" },
    ],
    { two: true },
  ],
  [
    "an undo of a script and a title the frame refuses, and a newer run, both answered after the undo's deadline",
    [
      { save: "undoBoth", fate: "frame" },
      { save: "run", fate: "frame" },
      { pastDeadline: true },
      { answer: "oldest" },
      { answer: "oldest" },
    ],
  ],
  // A guard: Studio's reload loads the newer file again when a save lands during it (useShadowPreviewReload.ts).
  [
    "a run saved while the reload from a refused title undo is in flight",
    [{ save: "undoTitle", fate: "frame" }, { answer: "oldest" }, { save: "run", fate: "frame" }],
  ],
  // The round-8 generator's seeds that found a class without the fix, kept as it generated them: 50 a recovery
  // dropping saved timing; 80 and 261 a recovery rewinding a newer scrub; 312, 147 and 377 a port rejection taken
  // for a missing reply.
  ...(
    [
      [
        50,
        [
          { save: "undoLabel", fate: "frame" },
          { answer: "any" },
          { answer: "any" },
          { scrub: 4 },
          { save: "undoBoth", fate: "refused" },
          { reloadFrame: true },
          { save: "liveRetime", fate: "refused" },
          { save: "patch", fate: "frame" },
        ],
      ],
      [
        80,
        [
          { scrub: 1 },
          { save: "undoBoth", fate: "frame" },
          { answer: "any" },
          { save: "liveRetime", fate: "refused" },
          { save: "run", fate: "frame" },
          { save: "retime", fate: "frame" },
          { scrub: 4 },
          { save: "run", fate: "refused" },
        ],
      ],
      [
        261,
        [
          { scrub: 3 },
          { scrub: 1 },
          { save: "liveRetime", fate: "refused" },
          { save: "retime", fate: "frame" },
          { reloadFrame: true },
          { save: "liveRetime", fate: "refused" },
          { scrub: 3 },
          { answer: "any" },
        ],
      ],
      [
        312,
        [
          { answer: "any" },
          { scrub: 4 },
          { reloadFrame: true },
          { answer: "any" },
          { reloadFrame: true },
          { save: "liveRetime", fate: "rejected" },
          { scrub: 4 },
          { save: "run", fate: "frame" },
        ],
      ],
      [
        147,
        [
          { save: "patch", fate: "frame" },
          { answer: "any" },
          { scrub: 3 },
          { save: "patch", fate: "frame" },
          { answer: "any" },
          { save: "undoBoth", fate: "rejected" },
          { save: "liveRetime", fate: "frame" },
          { save: "patch", fate: "rejected" },
        ],
      ],
      [
        377,
        [
          { save: "undoBoth", fate: "rejected" },
          { answer: "any" },
          { reloadFrame: true },
          { save: "patch", fate: "frame" },
          { answer: "any" },
          { scrub: 4 },
          { save: "undoBoth", fate: "rejected" },
          { save: "liveRetime", fate: "refused" },
        ],
      ],
    ] as Array<[number, Step[]]>
  ).map(([seed, steps]): Fixed => [`round-8 seed ${seed}`, steps, { seed }]),
];

describe("sealed preview after late answers in any order", () => {
  it.each(SEEDS)("%s", async (name, steps, { seed, two } = {}) => {
    const { shown, fresh, reloads, reloadRefusals, playhead } = await play(steps, seed, two);
    expect(shown).toEqual(fresh);
    expect(playhead.shown).toBeCloseTo(playhead.studio, 1);
    // A two-script file has no single script to snapshot, so a recovery there may only reload.
    if (reloadRefusals === 0 && !two) expect(reloads).toBe(0);
    // The frame cannot set a title in place, so the refused undo recovers only by reloading.
    if (name.includes("title")) expect(reloads).toBeGreaterThan(0);
  });

  // Seeds that found a round-9 class without the fix: 312 and 320 a write of saved state never answered, then
  // covered by a script-only run; 2101, 3037 and 3657 a two-script file's newer timing undo overwritten.
  it.each([312, 320, 2101, 3037, 3657])("generated sequence %i", (seed) =>
    expectGenerated(browser, studioBundle, seed),
  );
});
