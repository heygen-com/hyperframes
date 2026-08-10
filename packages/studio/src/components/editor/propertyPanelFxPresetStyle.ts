/**
 * A title treatment per preset — the label as a small piece of design rather
 * than eighteen rows of the same condensed caps.
 *
 * The rack already letters by FAMILY (`propertyPanelFxFamily.ts`), which answers
 * "what kind of thing is this". This answers a different question: a preset is a
 * character, and the point of Telephone or Megaphone is that you know what it
 * sounds like before you play it. Type can carry that — a bullhorn's name should
 * look shouted, a tape's should look worn.
 *
 * Deliberately NOT a per-preset colour free-for-all. Each hue sits in the same
 * narrow lightness band as the family tints so nothing reads as a status colour,
 * and the panel already spends saturation on "automated" and "bypassed".
 *
 * A preset with no entry falls back to the neutral treatment, so the catalogue
 * can grow without this file — an unstyled preset looks plain, not broken.
 */

export interface FxPresetStyle {
  /** Tailwind classes for the title itself. */
  type: string;
  /** The title's colour, and the bracket's left edge. */
  color: string;
}

/** Plain, and what any preset without its own entry gets. */
export const FX_PRESET_STYLE_DEFAULT: FxPresetStyle = {
  type: "font-mono uppercase tracking-wide",
  color: "hsl(220, 12%, 68%)",
};

export const FX_PRESET_STYLE: Record<string, FxPresetStyle> = {
  // --- voice: the ones you reach for to sound like yourself, only better -----
  // Nothing stylised. These are corrective, and a costume on the title would
  // promise a character they deliberately do not add.
  "voice-clean": { type: "font-sans font-medium tracking-tight", color: "hsl(155, 34%, 70%)" },
  "voice-broadcast": {
    type: "font-sans font-bold uppercase tracking-[0.16em]",
    color: "hsl(155, 34%, 74%)",
  },
  "voice-warm": { type: "font-serif italic tracking-normal", color: "hsl(28, 40%, 74%)" },

  // --- repair: workshop labels. Mono, plain, nothing decorative -------------
  "rumble-cut": { type: "font-mono uppercase tracking-[0.18em]", color: "hsl(205, 28%, 70%)" },
  "room-gate": { type: "font-mono uppercase tracking-[0.18em]", color: "hsl(205, 28%, 70%)" },
  "boom-tame": { type: "font-mono uppercase tracking-[0.18em]", color: "hsl(205, 28%, 70%)" },
  "harsh-tame": { type: "font-mono uppercase tracking-[0.18em]", color: "hsl(205, 28%, 70%)" },

  // --- character: the costumes. This is where type does the work ------------
  // A phone's band is narrow; so is the tracking.
  telephone: { type: "font-mono uppercase tracking-[0.3em]", color: "hsl(190, 34%, 70%)" },
  // Period radio lettering — a serif, spaced like a dial face.
  "radio-am": { type: "font-serif uppercase tracking-[0.22em]", color: "hsl(38, 40%, 72%)" },
  // Shouted: heavy, tight, leaning forward.
  megaphone: {
    type: "font-sans font-black italic uppercase tracking-tight",
    color: "hsl(14, 46%, 70%)",
  },
  // Worn and slightly off — the italic serif is the closest thing to a wobble.
  "lofi-tape": { type: "font-serif italic tracking-wide", color: "hsl(36, 30%, 68%)" },
  // Institutional signage: wide, even, impersonal.
  "pa-system": {
    type: "font-sans font-semibold uppercase tracking-[0.26em]",
    color: "hsl(210, 26%, 72%)",
  },
  // Small, boxed-in, squeezed through a grille.
  intercom: { type: "font-mono font-bold uppercase tracking-tighter", color: "hsl(96, 26%, 68%)" },
  // The name is a joke and the type should be in on it.
  "doofus-worble": {
    type: "font-serif font-bold italic tracking-[0.12em]",
    color: "hsl(286, 38%, 74%)",
  },

  // --- space: rooms. Light and wide, because that is what space looks like ---
  "room-tight": {
    type: "font-sans font-light uppercase tracking-[0.2em]",
    color: "hsl(250, 26%, 72%)",
  },
  "room-natural": {
    type: "font-sans font-light uppercase tracking-[0.24em]",
    color: "hsl(250, 26%, 74%)",
  },
  hall: {
    type: "font-sans font-extralight uppercase tracking-[0.34em]",
    color: "hsl(250, 28%, 76%)",
  },
  "slap-echo": { type: "font-mono uppercase tracking-[0.28em]", color: "hsl(268, 30%, 72%)" },
  "dub-throw": { type: "font-mono italic tracking-[0.3em]", color: "hsl(268, 34%, 74%)" },
};

export function fxPresetStyle(presetId: string): FxPresetStyle {
  return FX_PRESET_STYLE[presetId] ?? FX_PRESET_STYLE_DEFAULT;
}
