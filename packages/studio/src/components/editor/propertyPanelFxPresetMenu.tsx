/**
 * The preset shelf for the FX rack.
 *
 * Its own module rather than another block inside the section: the section is
 * already the largest file in the panel, and this surface is going to grow —
 * search, per-item descriptions and a preview of the chain each preset draws
 * are all queued behind it.
 */

import {
  audioFxPresetsByFamily,
  HF_AUDIO_FX_PRESET_FAMILIES,
  type HfAudioFxPresetFamily,
} from "@hyperframes/core/audio-fx-presets";
import { PRESET_PROBLEM } from "@hyperframes/core/audio-fx-copy";

/**
 * Shelf names in the author's language, which is deliberately not the effect
 * registry's grouping. `group` says what an effect *is* (filter, dynamics);
 * somebody reaching for Telephone is shopping for what they *want*, and
 * Telephone is filters and saturation — nobody looks for it under either.
 */
const FAMILY_LABEL: Record<HfAudioFxPresetFamily, string> = {
  voice: "Voice",
  repair: "Fix",
  character: "Character",
  space: "Space",
};

export interface FxPresetMenuProps {
  onPick(id: string): void;
  /**
   * Play this preset on the running audio without persisting it, and revert on
   * `null`. Absent when there is no preview channel to hear it through.
   */
  onAudition?(id: string | null): void;
}

/**
 * Presets read as the complaint they answer, not as their own names.
 *
 * The name is a thing you have to already know — "Telephone", "Broadcast" — and
 * the author arriving here does not know it; they know their voice sounds
 * boomy. So the sentence leads and the name follows underneath, which is also
 * how the name gets learned. The four shelves stay because eighteen sentences
 * in a column is a wall, and they are already the author's grouping rather than
 * the registry's. See `plans/audio-fx-ux/README.md` §Decided.
 */
export function FxPresetMenu({ onPick, onAudition }: FxPresetMenuProps) {
  return (
    <div
      className="hf-fx-preset-menu space-y-1.5 rounded-[4px] border border-panel-border-input p-1.5"
      // One handler for the shelf rather than one per button: leaving any preset
      // for the gap between two of them has to revert, and a per-button leave
      // fires that on the way to the next one.
      onMouseLeave={onAudition ? () => onAudition(null) : undefined}
      // Focus leaving the shelf is the keyboard's version of the pointer leaving
      // it. Moving between two buttons inside fires this and then the next
      // button's focus, so it reverts and re-auditions rather than sticking.
      onBlur={onAudition ? () => onAudition(null) : undefined}
    >
      {HF_AUDIO_FX_PRESET_FAMILIES.map((family) => (
        <div key={family} className="hf-fx-preset-group space-y-0.5">
          <span className="hf-fx-preset-group-label block font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
            {FAMILY_LABEL[family]}
          </span>
          {audioFxPresetsByFamily(family).map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="hf-fx-preset-item block w-full rounded-[3px] bg-panel-surface px-1.5 py-1 text-left text-panel-text-1 hover:text-panel-text-0"
              // The description says what it does; the count is doing real work
              // — it tells the author a preset IS a chain they can open and
              // edit, rather than an opaque setting they cannot follow.
              title={`${preset.description} (${preset.nodes.length} effect${
                preset.nodes.length === 1 ? "" : "s"
              })`}
              onClick={() => onPick(preset.id)}
              onMouseEnter={onAudition ? () => onAudition(preset.id) : undefined}
              // Keyboard reaches this too: arrowing down the shelf auditions the
              // same way hovering does, or the whole affordance is mouse-only.
              onFocus={onAudition ? () => onAudition(preset.id) : undefined}
            >
              <span className="hf-fx-preset-problem block truncate text-[10px]">
                {PRESET_PROBLEM[preset.id] ?? preset.description}
              </span>
              <span className="hf-fx-preset-name block truncate font-mono text-[9px] text-panel-text-4">
                {preset.label}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
