/**
 * The narration pair two automation tests both need.
 *
 * Two slices sharing a row, each minting its OWN fx chain, so the node ids
 * collide across them while meaning different things. That collision is the
 * thing under test in both files, which is why the fixture has to be identical
 * in both and therefore has to live in one place.
 */

const chainOf = (nodes: unknown[]): string => JSON.stringify({ version: 1, nodes });

export const lanesOf = (...targets: string[]): string =>
  JSON.stringify({
    version: 1,
    lanes: targets.map((target) => ({ target, points: [{ t: 0, v: 1 }] })),
  });

/** A low-pass plus a 1 kHz peaking bell, whose Q the first slice automates. */
export const NARRATION_1_CHAIN = chainOf([
  { type: "lowpass", id: "n1", params: { frequency: 8000, q: 0.7, poles: "2" } },
  { type: "peaking", id: "n2", params: { frequency: 1000, gain: -3, q: 1.4 } },
]);

/** The same 1 kHz bell, but minted first, so it takes the id the other gave
 *  its low-pass. Grouping by target alone would merge these two rows. */
export const NARRATION_2_CHAIN = chainOf([
  { type: "peaking", id: "n1", params: { frequency: 1000, gain: -6, q: 1.4 } },
]);
