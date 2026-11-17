// The bounds on a gsap-snapshot reply. The frame refuses to send past them and Studio refuses to hold past them.
export const MAX_SNAPSHOT_TWEENS = 2_048;
export const MAX_SNAPSHOT_TARGETS = 512;
/** Channels read per target, and fields across every tween's vars. */
export const MAX_SNAPSHOT_CHANNELS = 64;
export const MAX_SNAPSHOT_FIELDS = 100_000;
export const MAX_SNAPSHOT_TEXT = 4_096;
export const MAX_VARS_DEPTH = 6;
