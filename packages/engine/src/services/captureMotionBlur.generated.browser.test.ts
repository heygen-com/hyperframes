import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Differential } from "./__fixtures__/blurDifferential.js";
import { hasBrowser } from "./__fixtures__/motionBlur/blurPage.js";
import {
  CASE_TIMEOUT_MS,
  blurOffDisagreement,
  chrome,
  firstFive,
  isSupported,
  measureInside,
  type Measured,
  measureOutside,
  startChrome,
  stopChrome,
} from "./__fixtures__/motionBlur/differentialPage.js";
import {
  generateComposition,
  parseSeeds,
  type GeneratedFixture,
} from "./__fixtures__/motionBlur/generate.js";
import { INVARIANTS } from "./__fixtures__/motionBlur/thresholds.js";

const SEEDS = parseSeeds(process.env.HF_BLUR_SEEDS ?? "1,2,3");
const FAILURES_FILE = process.env.HF_BLUR_FAILURES_FILE;
const REQUIRED = process.env.HF_BLUR_REQUIRED === "1";

interface KnownBad {
  finding: string;
  reason: string;
}

const KNOWN_BAD: Readonly<Record<number, KnownBad>> = {};

interface FailureRecord {
  seed: number | null;
  features: readonly string[];
  problems: readonly string[];
  unstableReference?: number;
}

const records: FailureRecord[] = [];

const worst = (d: Differential): string =>
  `${d.bad.length} bad tiles, worst MAE ${d.worstMae.toFixed(1)}, first ${firstFive(d)}`;

interface Outcome {
  problems: string[];
  unstable: number[];
}

async function judge(
  f: GeneratedFixture,
  region: "outside" | "inside",
  t: number,
  first: Measured,
  outcome: Outcome,
): Promise<void> {
  if (first.d.bad.length === 0) return;
  const disagreement = await blurOffDisagreement(chrome(), f, region, t, first);
  if (disagreement === undefined) {
    outcome.problems.push(`${region} the trail at ${t}: ${worst(first.d)}`);
  } else {
    outcome.unstable.push(disagreement);
  }
}

async function check(f: GeneratedFixture): Promise<Outcome> {
  const outcome: Outcome = { problems: [], unstable: [] };
  const times = [...f.checkpoints, ...f.moving].sort((a, b) => a - b);
  for (const t of times) {
    const moving = f.moving.includes(t);
    const outside = await measureOutside(chrome(), f, t);
    await judge(f, "outside", t, outside, outcome);
    if (!moving && outside.d.checkedFraction < INVARIANTS.minCheckedFraction) {
      outcome.problems.push(
        `outside the trail at ${t}: only ${outside.d.checkedFraction} of the frame was checked`,
      );
    }
    if (outside.d.checkedBlocks === 0) {
      outcome.problems.push(`outside the trail at ${t}: no tile was checked`);
    }
    if (!moving) continue;
    const inside = await measureInside(chrome(), f, t);
    await judge(f, "inside", t, inside, outcome);
    if (inside.d.checkedBlocks === 0) {
      outcome.problems.push(`inside the trail at ${t}: no tile was checked`);
    }
  }
  return outcome;
}

function defineSeedCase(seed: number): void {
  const f = generateComposition(seed);
  const pinned = KNOWN_BAD[seed];
  it(
    pinned ? `KNOWN BAD on main: ${pinned.finding}: ${pinned.reason}: ${f.name}` : f.name,
    async (ctx) => {
      if (!isSupported()) ctx.skip();
      let found: string[] = [];
      ctx.onTestFailed(() => {
        const thrown = ctx.task.result?.errors?.map((e) => String(e.message)) ?? [];
        records.push({ seed, features: f.features, problems: found.length ? found : thrown });
      });
      const { problems, unstable } = await check(f);
      if (pinned) {
        expect(
          problems.length,
          `${pinned.finding} looks fixed: delete seed ${seed} from KNOWN_BAD`,
        ).toBeGreaterThan(0);
        return;
      }
      found = problems;
      if (problems.length === 0 && unstable.length > 0) {
        records.push({
          seed,
          features: f.features,
          problems: [],
          unstableReference: Math.max(...unstable),
        });
      }
      expect(problems, `${f.name}: rerun with HF_BLUR_SEEDS=${seed}`).toEqual([]);
    },
    CASE_TIMEOUT_MS * 2,
  );
}

async function startRequiredChrome(): Promise<void> {
  if (!hasBrowser) throw new Error("HF_BLUR_REQUIRED is set but no Chrome was found");
  await startChrome();
  if (!isSupported())
    throw new Error("HF_BLUR_REQUIRED is set but this Chrome lacks drawElementImage");
}

describe.skipIf(!hasBrowser && !REQUIRED)(
  "capture motion blur over generated compositions in Chrome",
  () => {
    beforeAll(async () => {
      try {
        await (REQUIRED ? startRequiredChrome() : startChrome());
      } catch (error) {
        records.push({ seed: null, features: [], problems: [`Chrome did not start: ${error}`] });
        throw error;
      }
    }, 30_000);
    afterAll(async () => {
      try {
        if (FAILURES_FILE) writeFileSync(FAILURES_FILE, JSON.stringify(records, null, 2));
      } finally {
        await stopChrome();
      }
    });

    for (const seed of SEEDS) defineSeedCase(seed);
  },
);
