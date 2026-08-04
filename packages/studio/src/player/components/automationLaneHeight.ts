/**
 * Height of one audio automation lane.
 *
 * Its own module because both the row layout and the lane itself need it, and
 * putting it in either would have the layout importing a component or the
 * component's constant living somewhere it is not used.
 *
 * Taller than a keyframe lane because it carries a value axis rather than a row
 * of diamonds: a fader envelope drawn 28px high cannot be aimed.
 */
export const AUTOMATION_LANE_H = 48;
