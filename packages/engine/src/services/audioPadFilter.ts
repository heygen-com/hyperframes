/**
 * Pad-to-duration filter chain, shared by every audio path that has to hold a
 * stream to the composition's length.
 *
 * Two live call sites build this chain (the engine mixer and the producer's
 * pad/trim step), plus the producer's audio extractor, which is currently
 * unreferenced. Before this module they each rebuilt the string by hand, so a
 * fix in one did not reach the others.
 *
 * ## Why the chain is three filters and not one
 *
 * `apad` with no duration pads indefinitely; the trailing `atrim` is what
 * bounds it. That pairing is deliberate: `apad=whole_dur=<seconds>` says the
 * same thing in one filter, but the bundled Windows FFmpeg builds reject the
 * option outright (`Error applying option 'whole_dur': Option not found`), and
 * it does not bound a branch that is already *longer* than the target — an FX
 * tail that overruns the composition survives `whole_dur` and is cut by
 * `atrim`.
 *
 * On the FFmpeg 7.x line, however, `atrim` reading `apad`'s output timestamps
 * directly is what broke the mix: audio leaked to `t=0` from three mixed
 * branches onward, and from four branches onward the branch with the largest
 * `adelay` vanished from the output entirely. Nothing errored.
 *
 * Measured on linux/amd64, the affected window is 7.x only: 4.2.7, 6.0.1, git
 * master from 2026-05 and 8.1.1 all produce correct output from the bare
 * `apad,atrim` pairing, and produce byte-identical output with the `asetpts`
 * in place. So this chain is a no-op everywhere except the versions it fixes,
 * and it stays because the next release to regress here cannot be predicted.
 *
 * `asetpts=N/SR/TB` between them rebuilds each frame's timestamp from the
 * running sample count, so `atrim` sees a monotonic sample-accurate timeline
 * instead of whatever the release propagates through an indefinite `apad`.
 * Measured against FFmpeg 7.0.2, the output is then sample-for-sample what
 * `apad=whole_dur` produces — without giving up the `atrim` bound or the
 * Windows builds.
 *
 * @param seconds Target duration, already formatted for a filter string by the
 *   caller. Each call site has its own number formatting and this helper must
 *   not silently change it.
 */
export function buildPadToDurationFilter(seconds: string): string {
  return `apad,asetpts=N/SR/TB,atrim=0:${seconds}`;
}
