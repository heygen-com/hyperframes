/**
 * The plain-language layer over the effect registry.
 *
 * Every entry is written for somebody who has never opened a mixer. The rule
 * used throughout: name the OUTCOME, never the mechanism, and describe a control
 * by what changes in the sound rather than what it does to the signal.
 *
 * This is a layer *over* the registry, not a replacement for it. `HF_AUDIO_FX`
 * stays the authority on what an effect is and what its parameters do; this says
 * what to call those things in front of an author. `audioFxCopy.test.ts` holds
 * the two together — every shipped effect, every one of its parameters, and
 * every preset must have an entry here, so adding one to the registry without
 * copy fails a test rather than shipping a rack panel labelled `highpass`.
 *
 * Tone and the levelling module are deliberately absent: both carry their own
 * copy in core already (`audioEqSummary`, `levellingSummary`), because a summary
 * that has to read the chain belongs beside the code that writes it.
 *
 * Design rationale, and the review page built from this, in
 * `plans/audio-fx-ux/README.md`.
 */

export interface Ends {
  /** What the low end of the control sounds like. */
  low: string;
  high: string;
}

export interface ParamCopy {
  label: string;
  hint?: string;
  ends?: Ends;
}

export interface EffectCopy {
  /** What the module is called in the rack. Never the DSP name. */
  title: string;
  /** One line: what it is for. Present tense, second person implied. */
  does: string;
  /** The problem an author would say out loud that leads here. */
  reachFor: string;
  /**
   * The single control that carries the module. Either a real parameter key,
   * or "strength" — meaning the module gets one derived knob and the real
   * parameters live behind Details.
   */
  primary: string;
  primaryEnds: Ends;
  /** Plain names for the real parameters, shown only under Details. */
  params: Record<string, ParamCopy>;
  /** Which frequencies it acts on, for the shared ruler. Omit if not spectral. */
  band?: [number, number];
}

export const EFFECT_COPY: Record<string, EffectCopy> = {
  gain: {
    title: "Volume",
    does: "Turns this track up or down.",
    reachFor: "It's too loud, or too quiet, against everything else.",
    primary: "gain",
    primaryEnds: { low: "Silent", high: "Louder" },
    params: { gain: { label: "Level", ends: { low: "Silent", high: "Louder" } } },
  },
  highpass: {
    title: "Remove Rumble",
    does: "Cuts the very bottom — traffic, footsteps, air conditioning, hands on the mic.",
    reachFor: "There's a low hum or thump under everything.",
    primary: "frequency",
    primaryEnds: { low: "Only the deepest", high: "Thins it out" },
    band: [20, 300],
    params: {
      frequency: {
        label: "Cut below",
        hint: "Everything under this is removed.",
        ends: { low: "Only the deepest", high: "Thins it out" },
      },
      q: { label: "Sharpness", hint: "How abruptly the cut starts." },
      poles: { label: "Steepness", hint: "How fast it falls away below the point." },
    },
  },
  lowpass: {
    title: "Muffle",
    does: "Takes the top off, like the sound is coming through a door.",
    reachFor: "You want something to sound distant, or behind something else.",
    primary: "frequency",
    primaryEnds: { low: "Very muffled", high: "Barely changed" },
    band: [1000, 20000],
    params: {
      frequency: { label: "Cut above", ends: { low: "Very muffled", high: "Barely changed" } },
      q: { label: "Sharpness" },
      poles: { label: "Steepness" },
    },
  },
  peaking: {
    title: "Shape One Range",
    does: "Lifts or lowers one part of the sound and leaves the rest alone.",
    reachFor: "One quality is wrong — boomy, boxy, harsh — but the rest is fine.",
    primary: "gain",
    primaryEnds: { low: "Take it out", high: "Bring it forward" },
    band: [20, 20000],
    params: {
      frequency: { label: "Where", hint: "Which part of the sound to change." },
      gain: { label: "How much", ends: { low: "Take it out", high: "Bring it forward" } },
      q: {
        label: "How wide",
        hint: "A narrow setting fixes one note; a wide one changes the whole character.",
      },
    },
  },
  lowshelf: {
    title: "Bass",
    does: "More or less weight underneath everything.",
    reachFor: "It sounds thin, or too heavy.",
    primary: "gain",
    primaryEnds: { low: "Thinner", high: "Heavier" },
    band: [20, 300],
    params: {
      frequency: { label: "Up to", hint: "Everything below this is lifted or dropped." },
      gain: { label: "How much", ends: { low: "Thinner", high: "Heavier" } },
    },
  },
  highshelf: {
    title: "Brightness",
    does: "More or less sparkle at the top.",
    reachFor: "It sounds dull, or too fizzy.",
    primary: "gain",
    primaryEnds: { low: "Duller", high: "Brighter" },
    band: [2000, 20000],
    params: {
      frequency: { label: "From", hint: "Everything above this is lifted or dropped." },
      gain: { label: "How much", ends: { low: "Duller", high: "Brighter" } },
    },
  },
  compressor: {
    title: "Even Out Loudness",
    does: "Brings the quiet parts up and holds the loud parts down, so nothing jumps out at the listener.",
    reachFor: "Some parts are much louder than others.",
    primary: "strength",
    primaryEnds: { low: "Barely touched", high: "Very even, quite squashed" },
    params: {
      threshold: { label: "Starts working at", hint: "Anything louder than this gets held down." },
      ratio: { label: "How hard", hint: "How much of the excess is removed." },
      attack: { label: "How fast it grabs", ends: { low: "Instant", high: "Lets peaks through" } },
      release: { label: "How fast it lets go", ends: { low: "Snappy", high: "Smooth" } },
      knee: { label: "How gradual" },
      makeup: {
        label: "Volume back up",
        hint: "Compression makes things quieter; this puts the level back.",
      },
      mix: { label: "Blend with the original" },
    },
  },
  limiter: {
    title: "Peak Ceiling",
    does: "Nothing gets louder than this, ever. A safety net at the end of the chain.",
    reachFor: "You want to be sure it never clips or spikes.",
    primary: "limit",
    primaryEnds: { low: "A lot of headroom", high: "Right up to the edge" },
    params: {
      limit: {
        label: "Never exceed",
        ends: { low: "A lot of headroom", high: "Right up to the edge" },
      },
      attack: { label: "How fast it catches" },
      release: { label: "How fast it recovers" },
      level_out: { label: "Level after" },
    },
  },
  gate: {
    title: "Silence the Gaps",
    does: "Mutes the pauses. Whatever sits underneath stays — this closes the gaps, it does not remove noise.",
    reachFor: "You can hear the room in the gaps.",
    primary: "strength",
    primaryEnds: { low: "Only true silence", high: "Cuts quiet parts too" },
    params: {
      threshold: { label: "Quieter than this is a gap" },
      range: {
        label: "How far to duck the gaps",
        hint: "Not all the way down, usually — total silence sounds broken.",
      },
      ratio: { label: "How hard" },
      attack: { label: "How fast it opens" },
      release: {
        label: "How fast it closes",
        ends: { low: "Clips tails short", high: "Leaves tails intact" },
      },
      knee: { label: "How gradual" },
    },
  },
  saturate: {
    title: "Warmth",
    does: "Adds a little grit and density, the way analogue gear does.",
    reachFor: "It sounds clean but lifeless.",
    primary: "strength",
    primaryEnds: { low: "Just a sheen", high: "Openly distorted" },
    params: {
      type: {
        label: "Character",
        hint: "Different flavours of the same idea. Tanh is the gentle one.",
      },
      threshold: {
        label: "How much drive",
        ends: { low: "Just a sheen", high: "Openly distorted" },
      },
      output: { label: "Level after", hint: "Drive makes things louder; this puts it back." },
      oversample: { label: "Quality", hint: "Higher costs more but sounds cleaner." },
    },
  },
  bitcrush: {
    title: "Lo-Fi",
    does: "Crushes the sound down to fewer steps, like an old sampler or a bad phone line.",
    reachFor: "You want it to sound cheap or digital on purpose.",
    primary: "strength",
    primaryEnds: { low: "Slightly gritty", high: "Destroyed" },
    params: {
      bits: { label: "How many steps", ends: { low: "Destroyed", high: "Clean" } },
      samples: {
        label: "How rough",
        hint: "Holds each value for longer, which dulls and grits it.",
      },
      mix: { label: "Blend with the original" },
    },
  },
  pitchshift: {
    title: "Higher or Lower",
    does: "Shifts everything up or down without changing its speed.",
    reachFor: "It should sound squeakier, or deeper.",
    primary: "semitones",
    primaryEnds: { low: "Much deeper", high: "Much higher" },
    params: {
      semitones: { label: "How far", ends: { low: "Much deeper", high: "Much higher" } },
      mix: { label: "Blend with the original" },
    },
  },
  delay: {
    title: "Echo",
    does: "Repeats the sound after a gap.",
    reachFor: "You want space, or a rhythmic effect.",
    primary: "mix",
    primaryEnds: { low: "A hint", high: "Washed out" },
    params: {
      time: { label: "Gap between repeats" },
      feedback: { label: "How many repeats", ends: { low: "One", high: "Trails away for ages" } },
      mix: { label: "How loud", ends: { low: "A hint", high: "Washed out" } },
    },
  },
  reverb: {
    title: "Room",
    does: "Puts the sound somewhere, instead of nowhere.",
    reachFor: "It sounds dry and stuck to the speaker.",
    primary: "strength",
    primaryEnds: { low: "A small tight room", high: "A big open hall" },
    params: {
      size: { label: "How big the space is" },
      damping: {
        label: "How soft the walls are",
        ends: { low: "Hard and bright", high: "Soft and dark" },
      },
      wet: { label: "How much room" },
      dry: { label: "How much original" },
    },
  },
  chorus: {
    title: "Thicken",
    does: "Doubles the sound slightly out of tune, which makes it wider and less exact.",
    reachFor: "It sounds thin or too plain on its own.",
    primary: "mix",
    primaryEnds: { low: "Just wider", high: "Obviously wobbling" },
    params: {
      delay: { label: "Spread" },
      depth: { label: "How much wobble" },
      speed: { label: "How fast it wobbles" },
      mix: { label: "How much", ends: { low: "Just wider", high: "Obviously wobbling" } },
    },
  },
  phaser: {
    title: "Swirl",
    does: "A filter that sweeps up and down, giving a moving, hollow shimmer.",
    reachFor: "You want movement, or a 1970s flavour.",
    primary: "out_gain",
    primaryEnds: { low: "Subtle", high: "Strong" },
    params: {
      in_gain: { label: "Depth in" },
      out_gain: { label: "How strong", ends: { low: "Subtle", high: "Strong" } },
      delay: { label: "Where it sweeps" },
      decay: { label: "How resonant" },
      speed: { label: "How fast it sweeps" },
      type: { label: "Shape of the sweep" },
    },
  },
};

/**
 * The shared vocabulary. Frequencies mean nothing to somebody who has not been
 * taught them; these words are what the same person would say unprompted, and
 * naming the ranges once teaches them everywhere they appear.
 */
export const BANDS: { from: number; to: number; name: string; says: string }[] = [
  { from: 20, to: 80, name: "Rumble", says: "traffic, footsteps, handling" },
  { from: 80, to: 250, name: "Weight", says: "body, warmth, low end" },
  { from: 250, to: 600, name: "Mud", says: "boxy, muffled, cardboard" },
  { from: 600, to: 2000, name: "Middle", says: "the body of the sound" },
  { from: 2000, to: 5000, name: "Presence", says: "definition, consonants" },
  { from: 5000, to: 10000, name: "Edge", says: "harshness, sibilance" },
  { from: 10000, to: 20000, name: "Air", says: "sparkle, openness" },
];

/**
 * Which named range a frequency falls in.
 *
 * The whole point of `BANDS` is that the words get taught, and they only get
 * taught if a module can say which one it is working in. Below the first band
 * and above the last both clamp rather than returning nothing: 15 Hz is still
 * rumble to anybody who can hear it, and the alternative is a filter at the edge
 * of its range having no name at all.
 */
export function audioBandAt(hz: number): (typeof BANDS)[number] | undefined {
  if (!Number.isFinite(hz)) return undefined;
  const first = BANDS[0];
  const last = BANDS.at(-1);
  if (first && hz < first.from) return first;
  if (last && hz >= last.to) return last;
  return BANDS.find((band) => hz >= band.from && hz < band.to);
}

/** Which everyday complaint each preset answers. Presets ARE the product here. */
export const PRESET_PROBLEM: Record<string, string> = {
  "voice-clean": "My voice sounds amateur",
  "voice-broadcast": "I want it to sound like radio",
  "voice-warm": "I want it intimate and close",
  "rumble-cut": "There's a hum or thump underneath",
  "room-gate": "I can hear the room in the gaps",
  "boom-tame": "It sounds boomy",
  "harsh-tame": "It's harsh and tiring to listen to",
  telephone: "Make it sound like a phone call",
  "radio-am": "Make it sound like an old radio",
  megaphone: "Make it sound shouted through a horn",
  "lofi-tape": "Make it sound like an old tape",
  "pa-system": "Make it sound like a station announcement",
  intercom: "Make it sound like a door intercom",
  "doofus-worble": "Make it wobble like it is seasick",
  "room-tight": "It sounds dry and stuck to the speaker",
  "room-natural": "It should sound like a real place",
  hall: "It should sound far away and big",
  "slap-echo": "I want one quick echo",
  "dub-throw": "I want long trailing echoes",
};

/**
 * What a module says when it is CLOSED.
 *
 * The most-seen state by a distance: a rack with six modules is six of these
 * and nothing else. So it is a sentence about what is happening to the sound,
 * not a dump of the parameter that happens to be first. An author should be
 * able to read the rack top to bottom and understand their own mix.
 *
 * Numbers stay in — they are what makes it checkable rather than vague — but
 * they arrive inside a phrase instead of on their own.
 */
type P = Record<string, unknown>;
const n = (v: unknown, fallback = 0) => (typeof v === "number" ? v : fallback);
const hz = (v: unknown) => {
  const x = n(v);
  return x >= 1000 ? `${(x / 1000).toFixed(x % 1000 === 0 ? 0 : 1)} kHz` : `${Math.round(x)} Hz`;
};
const strength = (x: number, words: [string, string, string]) =>
  x < 0.34 ? words[0] : x < 0.67 ? words[1] : words[2];

export const SUMMARY: Record<string, (p: P) => string> = {
  gain: (p) =>
    n(p.gain) === 0
      ? "No change"
      : n(p.gain) > 0
        ? `Up ${n(p.gain)} dB`
        : `Down ${Math.abs(n(p.gain))} dB`,
  highpass: (p) => `Cutting everything below ${hz(p.frequency)}`,
  lowpass: (p) => `Muffled above ${hz(p.frequency)}`,
  // A band at 0 dB is doing nothing, and saying "lifting by 0 dB" describes a
  // non-event as though it were a setting. Freshly added effects sit exactly
  // here, so this is the FIRST thing an author reads after adding one.
  peaking: (p) =>
    n(p.gain) === 0
      ? `Sitting on ${hz(p.frequency)}, doing nothing yet`
      : `${n(p.gain) > 0 ? "Lifting" : "Cutting"} ${hz(p.frequency)} by ${Math.abs(n(p.gain))} dB`,
  lowshelf: (p) =>
    n(p.gain) === 0
      ? "Doing nothing yet"
      : `${n(p.gain) > 0 ? "More" : "Less"} weight below ${hz(p.frequency)}`,
  highshelf: (p) =>
    n(p.gain) === 0
      ? "Doing nothing yet"
      : `${n(p.gain) > 0 ? "More" : "Less"} sparkle above ${hz(p.frequency)}`,
  compressor: (p) =>
    `Evening out — ${strength(Math.min(1, (n(p.ratio, 3) - 1) / 7), ["gentle", "moderate", "firm"])}`,
  limiter: (p) => `Nothing louder than ${n(p.limit, -1)} dB`,
  gate: (p) => `Closing gaps quieter than ${n(p.threshold, -45)} dB`,
  saturate: (p) =>
    `${strength(Math.min(1, Math.abs(n(p.threshold, -6)) / 30), ["A little", "Some", "Heavy"])} warmth`,
  bitcrush: (p) => `Crushed to ${n(p.bits, 8)} bits`,
  pitchshift: (p) =>
    n(p.semitones, 0) === 0
      ? "Unchanged pitch"
      : `${n(p.semitones, 0) > 0 ? "Up" : "Down"} ${Math.abs(n(p.semitones, 0))} semitones`,
  delay: (p) => `Echo every ${n(p.time, 250)} ms`,
  reverb: (p) =>
    `${strength(n(p.size, 0.7), ["A small", "A medium", "A large"])} room, ${strength(n(p.wet, 0.35), ["lightly", "moderately", "heavily"])}`,
  chorus: (p) => `Thickened${n(p.mix, 0.5) > 0.6 ? ", wobbling" : ""}`,
  phaser: () => "Swirling",
};
