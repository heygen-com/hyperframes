// Preloaded into a test process (`node --import`, or bunfig.toml for `bun test`): `Date` reads ten years ahead of the
// real clock, so a test that depends on today's date fails on the day it is written. ci.yml names the packages.
// The offset is fixed, so Node threads and child processes agree on the time; a Bun worker still reads the real
// clock. Test: scripts/test-clock-ahead.test.mjs.
const RealDate = globalThis.Date;
export const AHEAD_MS = 3653 * 86_400_000;

if (!Object.hasOwn(RealDate, "aheadOfRealClock")) {
  const now = () => RealDate.now() + AHEAD_MS;
  /** @this {unknown} @param {...unknown} args */
  function AheadDate(...args) {
    if (!new.target) return new RealDate(now()).toString();
    return Reflect.construct(RealDate, args.length ? args : [now()], new.target);
  }
  AheadDate.prototype = RealDate.prototype;
  AheadDate.prototype.constructor = AheadDate;
  Object.defineProperties(AheadDate, {
    name: { value: "Date" },
    length: { value: RealDate.length },
    now: { value: now, writable: true, configurable: true },
    parse: { value: RealDate.parse, writable: true, configurable: true },
    UTC: { value: RealDate.UTC, writable: true, configurable: true },
    aheadOfRealClock: { value: AHEAD_MS },
  });
  globalThis.Date = /** @type {DateConstructor} */ (/** @type {unknown} */ (AheadDate));
  // A Node process a test starts reads the same clock.
  if (!process.env.NODE_OPTIONS?.includes(import.meta.url))
    process.env.NODE_OPTIONS =
      `${process.env.NODE_OPTIONS ?? ""} --import ${import.meta.url}`.trim();
}
