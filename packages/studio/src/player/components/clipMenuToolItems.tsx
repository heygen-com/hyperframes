import { useRef, useState, type KeyboardEvent } from "react";
import { HF_AUDIO_FX_ATTR } from "@hyperframes/core/audio-fx";
import { HF_COLOR_GRADING_ATTR } from "@hyperframes/core/color-grading";
import type { TimelineElement } from "../store/playerStore";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { useCropPresetBarStore } from "../../components/editor/cropPresetStore";
import {
  CHARACTER_CHOICES,
  LOOK_CHOICES,
  VOICE_CHOICES,
  activeLook,
  activeVoicePreset,
  chainWithVoicePreset,
  lookAttrValue,
  type ClipToolChoice,
} from "./clipToolAttrs";
import { useClipToolState } from "./useClipToolState";

export type ClipMenuToolGroup = "sound" | "picture";

interface ClipMenuToolItemsProps {
  group: ClipMenuToolGroup;
  element: TimelineElement;
  onClose: () => void;
}

const ROW_CLASS =
  "w-full flex items-center justify-between px-3 py-1.5 text-xs text-left outline-none focus-visible:bg-neutral-800 text-neutral-300 hover:bg-neutral-800 cursor-pointer";
const SUBMENU_WIDTH = 170;

interface ChoiceSection {
  heading?: string;
  choices: readonly ClipToolChoice[];
}

function focusSibling(menu: HTMLElement | null, step: number): void {
  if (!menu) return;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
  const index = items.findIndex((item) => item === document.activeElement);
  items[(index + step + items.length) % items.length]?.focus();
}

function ChoiceSubmenu({
  label,
  sections,
  activeId,
  onPick,
}: {
  label: string;
  sections: readonly ChoiceSection[];
  activeId: string | null;
  onPick: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [flipLeft, setFlipLeft] = useState(false);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);

  const show = (focusFirst: boolean) => {
    const rect = rowRef.current?.getBoundingClientRect();
    setFlipLeft(rect ? rect.right + SUBMENU_WIDTH > window.innerWidth : false);
    setOpen(true);
    if (focusFirst) requestAnimationFrame(() => focusSibling(submenuRef.current, 1));
  };

  const onSubmenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      focusSibling(submenuRef.current, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      rowRef.current?.focus();
    }
  };

  const choiceRow = (id: string | null, text: string) => (
    <button
      key={id ?? "none"}
      type="button"
      role="menuitemradio"
      aria-checked={activeId === id}
      className={ROW_CLASS}
      onClick={() => onPick(id)}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="w-3 text-center">
          {activeId === id ? "✓" : ""}
        </span>
        {text}
      </span>
    </button>
  );

  return (
    <div className="relative" onMouseEnter={() => show(false)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={rowRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={ROW_CLASS}
        onClick={() => show(true)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          show(true);
        }}
      >
        <span>{label}</span>
        <span className="text-neutral-500 text-[10px] ml-3">▸</span>
      </button>
      {open && (
        <div
          ref={submenuRef}
          role="menu"
          aria-label={label}
          className="absolute top-0 z-10 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1"
          style={{ width: SUBMENU_WIDTH, ...(flipLeft ? { right: "100%" } : { left: "100%" }) }}
          onKeyDown={onSubmenuKeyDown}
        >
          {choiceRow(null, "None")}
          {sections.map((section, index) => (
            <div key={section.heading ?? index}>
              {section.heading && (
                <>
                  <div className="my-1 border-t border-neutral-700/60" />
                  <div className="px-3 py-1 text-[9px] uppercase tracking-wide text-neutral-500">
                    {section.heading}
                  </div>
                </>
              )}
              {section.choices.map((choice) => choiceRow(choice.id, choice.label))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const VOICE_SECTIONS: readonly ChoiceSection[] = [
  { choices: VOICE_CHOICES },
  { heading: "Character", choices: CHARACTER_CHOICES },
];
const LOOK_SECTIONS: readonly ChoiceSection[] = [{ choices: LOOK_CHOICES }];

function isPictureClip(tag: string): boolean {
  return tag === "video" || tag === "img";
}

/** Voice, Look and Crop for the clip menu; each group renders its own trailing divider when it has items. */
export function ClipMenuToolItems({ group, element, onClose }: ClipMenuToolItemsProps) {
  const { onSetElementAttributeQuiet } = useTimelineEditContextOptional();
  const state = useClipToolState(element);
  const openCropBar = useCropPresetBarStore((s) => s.open);
  if (!onSetElementAttributeQuiet) return null;

  const write = (attr: string, value: string | null, label: string) => {
    void onSetElementAttributeQuiet(element, attr, value, label);
    onClose();
  };

  if (group === "sound") {
    if (!state.hasSound) return null;
    return (
      <>
        <ChoiceSubmenu
          label="Voice"
          sections={VOICE_SECTIONS}
          activeId={activeVoicePreset(state.fxChain)}
          onPick={(id) =>
            write(HF_AUDIO_FX_ATTR, chainWithVoicePreset(state.fxChain, id), "Voice preset")
          }
        />
        <div className="my-1 border-t border-neutral-700/60" />
      </>
    );
  }

  if (!isPictureClip(state.tag)) return null;
  return (
    <>
      <ChoiceSubmenu
        label="Look"
        sections={LOOK_SECTIONS}
        activeId={activeLook(state.colorGrading)}
        onPick={(id) => write(HF_COLOR_GRADING_ATTR, lookAttrValue(id), "Look")}
      />
      <button
        type="button"
        role="menuitem"
        className={ROW_CLASS}
        onClick={() => {
          openCropBar({ hfId: element.hfId, id: element.domId ?? element.id });
          onClose();
        }}
      >
        <span>Crop</span>
      </button>
      <div className="my-1 border-t border-neutral-700/60" />
    </>
  );
}
