#!/usr/bin/env bun
/**
 * Sunset governance for the canary registry.
 *
 * Every canary declares a `sunsetAfter` date. Without something that reads the
 * CURRENT date, that field is a comment: a rollout can sit at 10% forever and
 * nothing notices. The registry's own unit tests deliberately do NOT check it
 * against wall-clock time, because a date-triggered failure there turns the
 * whole core suite red on an unrelated PR whose author cannot fix it.
 *
 * So the check lives here and runs on a schedule instead. A failure names an
 * expired rollout and belongs to its owner, not to whoever pushed that day.
 *
 * Run: `bun scripts/check-canary-sunset.ts`
 */
import { CANARIES, overdueCanaries } from "../packages/core/src/canaryRegistry.js";

const overdue = overdueCanaries(new Date());

if (overdue.length === 0) {
  console.log(`✓ ${CANARIES.length} canary/canaries registered, none past sunset.`);
  process.exit(0);
}

console.error(`✗ ${overdue.length} canary/canaries are past their sunset date:\n`);
for (const name of overdue) {
  const canary = CANARIES.find((c) => c.name === name);
  console.error(
    `  ${name} — sunset ${canary?.sunsetAfter ?? "?"}, ${canary?.percentage ?? "?"}%, owner ${canary?.owner ?? "?"}`,
  );
}
console.error(
  "\nRamp it to 100 and delete the guard, roll it back, or move the date with a" +
    "\nreason. See docs/contributing/canary-rollouts.mdx.",
);
process.exit(1);
