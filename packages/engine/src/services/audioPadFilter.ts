/**
 * Pad-to-duration filter chain, shared by every audio path that has to hold a
 * stream to the composition's length.
 *
 * Three call sites build this chain — the engine mixer, the producer's audio
 * extractor, and the producer's pad/trim step — and before this module they
 * each rebuilt the string by hand, so a fix in one did not reach the others.
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
 * On FFmpeg 7 and newer, however, `atrim` reading `apad`'s output timestamps
 * directly is what broke the mix: audio leaked to `t=0` from three mixed
 * branches onward, and from four branches onward the branch with the largest
 * `adelay` vanished from the output entirely. Nothing errored.
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
