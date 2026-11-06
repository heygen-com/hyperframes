import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Differential } from "./__fixtures__/blurDifferential.js";
import { hasBrowser } from "./__fixtures__/motionBlur/blurPage.js";
import {
  CASE_TIMEOUT_MS,
  chrome,
  firstFive,
  isSupported,
  measureInside,
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

interface Failure {
  seed: number;
  features: readonly string[];
  problems: readonly string[];
}

const failures: Failure[] = [];

const worst = (d: Differential): string =>
  `${d.bad.length} bad tiles, worst MAE ${d.worstMae.toFixed(1)}, first ${firstFive(d)}`;

async function problemsOf(f: GeneratedFixture): Promise<string[]> {
  const problems: string[] = [];
  const times = [...f.checkpoints, ...f.moving].sort((a, b) => a - b);
  for (const t of times) {
    const moving = f.moving.includes(t);
    const outside = await measureOutside(chrome(), f, t);
    if (outside.bad.length > 0) problems.push(`outside the trail at ${t}: ${worst(outside)}`);
    if (!moving && outside.checkedFraction < INVARIANTS.minCheckedFraction) {
      problems.push(
        `outside the trail at ${t}: only ${outside.checkedFraction} of the frame was checked`,
      );
    }
    if (outside.checkedBlocks === 0)
      problems.push(`outside the trail at ${t}: no tile was checked`);
    if (!moving) continue;
    const inside = await measureInside(chrome(), f, t);
    if (inside.bad.length > 0) problems.push(`inside the trail at ${t}: ${worst(inside)}`);
    if (inside.checkedBlocks === 0) problems.push(`inside the trail at ${t}: no tile was checked`);
  }
  return problems;
}

function defineSeedCase(seed: number): void {
  const f = generateComposition(seed);
  const pinned = KNOWN_BAD[seed];
  it(
    pinned ? `KNOWN BAD on main: ${pinned.finding}: ${pinned.reason}: ${f.name}` : f.name,
    async (ctx) => {
      if (!isSupported()) ctx.skip();
      const problems = await problemsOf(f);
      if (pinned) {
        expect(
          problems.length,
          `${pinned.finding} looks fixed: delete seed ${seed} from KNOWN_BAD`,
        ).toBeGreaterThan(0);
        return;
      }
      if (problems.length > 0) failures.push({ seed, features: f.features, problems });
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
    beforeAll(REQUIRED ? startRequiredChrome : startChrome, 30_000);
    afterAll(async () => {
      await stopChrome();
      if (FAILURES_FILE) writeFileSync(FAILURES_FILE, JSON.stringify(failures, null, 2));
    });

    for (const seed of SEEDS) defineSeedCase(seed);
  },
);
