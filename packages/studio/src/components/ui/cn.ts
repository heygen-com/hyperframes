/**
 * Studio's configured class merger.
 *
 * Every primitive merges its variant, size, state and caller classes through
 * this one instance so the last class named wins, the way a caller expects.
 * Plain concatenation does not do that: two utilities from the same group both
 * survive into the class list and the winner is decided by their order in the
 * emitted stylesheet, which is why the Renders Export could not shrink its own
 * type size.
 *
 * The default config only knows Tailwind's own scales, so the two families
 * Studio invents in `theme.css` are declared here:
 *
 *  - `text-step-*` (the dense type scale) joins the `font-size` group, so a
 *    caller's `text-step-11` replaces a primitive's `text-sm` instead of
 *    stacking with it.
 *  - `ctl`, `ctl-sm` and `ctl-lg` (the three control heights) join the sizing
 *    groups, so `h-ctl-lg` replaces `h-ctl`.
 *
 * Both lists are patterns rather than enumerations: adding a step or a control
 * height to `theme.css` needs no edit here.
 */

import { createCn } from "cn/config";

/** `text-step-11`, `text-step-9`, … — the type scale from `theme.css`. */
const isTypeStep = (value: string) => /^step-\d+$/.test(value);

/** `ctl`, `ctl-sm`, `ctl-lg` — the control heights from `theme.css`. */
const isControlSize = (value: string) => /^ctl(-sm|-lg)?$/.test(value);

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: [isTypeStep] }],
      h: [{ h: [isControlSize] }],
      w: [{ w: [isControlSize] }],
      size: [{ size: [isControlSize] }],
      "min-h": [{ "min-h": [isControlSize] }],
      "min-w": [{ "min-w": [isControlSize] }],
    },
  },
});
