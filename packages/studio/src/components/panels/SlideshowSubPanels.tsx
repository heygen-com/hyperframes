/**
 * SlideshowSubPanels — internal sub-surface components for SlideshowPanel.
 * Not exported from the package index; used only by SlideshowPanel.tsx.
 */

import { useState, useCallback, useId } from "react";
import type { SlideRef, SlideHotspot, SlideSequence } from "@hyperframes/core/slideshow";
import type { DomEditSelection } from "../editor/domEditing";
import type { SceneInfo } from "./slideshowPanelHelpers";

// ── Section header (accordion toggle) ────────────────────────────────────

export function SectionHeader({
  children,
  expanded,
  onToggle,
}: {
  children: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium text-neutral-400 hover:text-neutral-200 border-b border-neutral-800 transition-colors"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <span>{children}</span>
      <span className="text-[10px] text-neutral-600">{expanded ? "▲" : "▼"}</span>
    </button>
  );
}

// ── Sub-surface: Slide List ──────────────────────────────────────────────

export interface SlideListProps {
  scenes: SceneInfo[];
  slides: SlideRef[];
  selectedSceneId: string | null;
  onSelect: (sceneId: string) => void;
  onToggle: (sceneId: string) => void;
  onReorder: (sceneId: string, dir: "up" | "down") => void;
}

export function SlideList({
  scenes,
  slides,
  selectedSceneId,
  onSelect,
  onToggle,
  onReorder,
}: SlideListProps) {
  return (
    <div className="flex flex-col gap-px">
      {scenes.map((scene) => {
        const isSlide = slides.some((s) => s.sceneId === scene.id);
        const isSelected = selectedSceneId === scene.id;
        return (
          <div
            key={scene.id}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer text-[11px] transition-colors ${
              isSelected
                ? "bg-studio-accent/20 text-white"
                : "hover:bg-neutral-800/60 text-neutral-300"
            }`}
            onClick={() => onSelect(scene.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(scene.id);
              }
            }}
          >
            <input
              type="checkbox"
              aria-label={`Include ${scene.label} as main-line slide`}
              checked={isSlide}
              onChange={() => onToggle(scene.id)}
              onClick={(e) => e.stopPropagation()}
              className="accent-studio-accent flex-shrink-0"
            />
            <span className="flex-1 truncate">{scene.label || scene.id}</span>
            {isSlide && (
              <span className="flex gap-0.5 flex-shrink-0">
                <button
                  type="button"
                  aria-label="Move slide up"
                  title="Move up"
                  className="px-1 py-0.5 text-[10px] text-neutral-400 hover:text-white disabled:opacity-30"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(scene.id, "up");
                  }}
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label="Move slide down"
                  title="Move down"
                  className="px-1 py-0.5 text-[10px] text-neutral-400 hover:text-white disabled:opacity-30"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(scene.id, "down");
                  }}
                >
                  ▼
                </button>
              </span>
            )}
          </div>
        );
      })}
      {scenes.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-neutral-500 italic">No scenes found</p>
      )}
    </div>
  );
}

// ── Sub-surface: Slide Inspector ─────────────────────────────────────────

export interface SlideInspectorProps {
  sceneId: string;
  slide: SlideRef | undefined;
  currentTime: number;
  onSetNotes: (notes: string) => void;
  onMarkFragment: () => void;
  onRemoveFragment: (time: number) => void;
}

// fallow-ignore-next-line complexity
export function SlideInspector({
  sceneId,
  slide,
  currentTime,
  onSetNotes,
  onMarkFragment,
  onRemoveFragment,
}: SlideInspectorProps) {
  const fragments = slide?.fragments ?? [];
  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <p className="text-[10px] text-neutral-500 font-medium uppercase tracking-wide truncate">
        Scene: {sceneId}
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-neutral-400">Notes</label>
        <textarea
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-[11px] text-white resize-none placeholder-neutral-600 focus:border-studio-accent/60 focus:outline-none"
          rows={3}
          placeholder="Speaker notes or script..."
          value={slide?.notes ?? ""}
          onChange={(e) => onSetNotes(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">Fragment hold-points</span>
          <button
            type="button"
            className="text-[10px] px-2 py-0.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 transition-colors"
            onClick={onMarkFragment}
            title={`Mark ${currentTime.toFixed(2)}s as hold-point`}
          >
            Mark {currentTime.toFixed(2)}s
          </button>
        </div>
        {fragments.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {fragments.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 bg-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-200"
              >
                {t.toFixed(2)}s
                <button
                  type="button"
                  aria-label={`Remove fragment at ${t.toFixed(2)}s`}
                  className="text-neutral-400 hover:text-red-400 transition-colors"
                  onClick={() => onRemoveFragment(t)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-neutral-600 italic">No hold-points yet</p>
        )}
      </div>
    </div>
  );
}

// ── Sub-surface: Branch Tree ──────────────────────────────────────────────

export interface BranchTreeProps {
  sequences: SlideSequence[];
  scenes: SceneInfo[];
  onCreateSequence: (label: string) => void;
  onRenameSequence: (id: string, label: string) => void;
  onDeleteSequence: (id: string) => void;
  onAssign: (sequenceId: string, sceneId: string, assign: boolean) => void;
}

export function BranchTree({
  sequences,
  scenes,
  onCreateSequence,
  onRenameSequence,
  onDeleteSequence,
  onAssign,
}: BranchTreeProps) {
  const [newLabel, setNewLabel] = useState("");
  const inputId = useId();

  const handleCreate = useCallback(() => {
    const label = newLabel.trim();
    if (!label) return;
    onCreateSequence(label);
    setNewLabel("");
  }, [newLabel, onCreateSequence]);

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex gap-1.5">
        <input
          id={inputId}
          type="text"
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-[11px] text-white placeholder-neutral-600 focus:border-studio-accent/60 focus:outline-none"
          placeholder="New branch name..."
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          aria-label="New branch sequence name"
        />
        <button
          type="button"
          className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-[11px] text-neutral-200 transition-colors flex-shrink-0"
          onClick={handleCreate}
        >
          Add
        </button>
      </div>

      {sequences.length === 0 ? (
        <p className="text-[10px] text-neutral-600 italic">No branches yet</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sequences.map((seq) => (
            <BranchItem
              key={seq.id}
              seq={seq}
              scenes={scenes}
              onRename={onRenameSequence}
              onDelete={onDeleteSequence}
              onAssign={onAssign}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface BranchItemProps {
  seq: SlideSequence;
  scenes: SceneInfo[];
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onAssign: (sequenceId: string, sceneId: string, assign: boolean) => void;
}

function BranchItem({ seq, scenes, onRename, onDelete, onAssign }: BranchItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(seq.label);

  const commitRename = useCallback(() => {
    const label = draft.trim();
    if (label && label !== seq.label) onRename(seq.id, label);
    setEditing(false);
  }, [draft, onRename, seq.id, seq.label]);

  return (
    <div className="border border-neutral-700/60 rounded p-2 flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {editing ? (
          <input
            className="flex-1 bg-neutral-800 border border-neutral-600 rounded px-1.5 py-0.5 text-[11px] text-white focus:border-studio-accent/60 focus:outline-none"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            aria-label={`Rename branch ${seq.label}`}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            className="flex-1 text-[11px] text-white font-medium truncate cursor-pointer hover:text-neutral-300"
            title="Click to rename"
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setEditing(true);
            }}
          >
            {seq.label}
          </span>
        )}
        <button
          type="button"
          aria-label={`Delete branch ${seq.label}`}
          className="text-[10px] text-neutral-500 hover:text-red-400 transition-colors px-1"
          onClick={() => onDelete(seq.id)}
        >
          ✕
        </button>
      </div>
      <div className="flex flex-col gap-px pl-2">
        {scenes.map((scene) => {
          const assigned = seq.slides.some((s) => s.sceneId === scene.id);
          return (
            <label
              key={scene.id}
              className="flex items-center gap-1.5 py-0.5 cursor-pointer text-[11px] text-neutral-400 hover:text-neutral-200"
            >
              <input
                type="checkbox"
                checked={assigned}
                onChange={(e) => onAssign(seq.id, scene.id, e.target.checked)}
                className="accent-studio-accent"
              />
              <span className="truncate">{scene.label || scene.id}</span>
            </label>
          );
        })}
        {scenes.length === 0 && <p className="text-[10px] text-neutral-600 italic">No scenes</p>}
      </div>
    </div>
  );
}

// ── Sub-surface: Hotspot Tool ─────────────────────────────────────────────

export interface HotspotToolProps {
  selectedSceneId: string | null;
  slide: SlideRef | undefined;
  domEditSelection: DomEditSelection | null;
  sequences: SlideSequence[];
  onAddHotspot: (sceneId: string, hotspot: SlideHotspot) => void;
  onRemoveHotspot: (sceneId: string, hotspotId: string) => void;
}

// fallow-ignore-next-line complexity
export function HotspotTool({
  selectedSceneId,
  slide,
  domEditSelection,
  sequences,
  onAddHotspot,
  onRemoveHotspot,
}: HotspotToolProps) {
  const [targetSequenceId, setTargetSequenceId] = useState("");
  const [hotspotLabel, setHotspotLabel] = useState("");
  const hotspots = slide?.hotspots ?? [];

  const selectedElementId = domEditSelection?.element?.id ?? null;
  const selectedHfId = domEditSelection?.hfId ?? null;
  const elementKey = selectedElementId || selectedHfId;

  // fallow-ignore-next-line complexity
  const handleMakeHotspot = useCallback(() => {
    if (!selectedSceneId || !targetSequenceId || !elementKey) return;
    const id = `hotspot-${elementKey}-${Date.now()}`;
    const label = hotspotLabel.trim() || elementKey;
    onAddHotspot(selectedSceneId, { id, label, target: targetSequenceId });
    setHotspotLabel("");
  }, [selectedSceneId, targetSequenceId, elementKey, hotspotLabel, onAddHotspot]);

  if (!selectedSceneId) {
    return (
      <div className="px-3 py-2">
        <p className="text-[11px] text-neutral-500 italic">Select a scene in the Slides list</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-neutral-400">
          Selected element:{" "}
          <span className="text-neutral-200 font-mono">{elementKey ?? "none"}</span>
        </p>
        <label className="text-[11px] text-neutral-400">Hotspot label</label>
        <input
          type="text"
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-[11px] text-white placeholder-neutral-600 focus:border-studio-accent/60 focus:outline-none"
          placeholder="Button label..."
          value={hotspotLabel}
          onChange={(e) => setHotspotLabel(e.target.value)}
          aria-label="Hotspot label"
        />
        <label className="text-[11px] text-neutral-400">Target branch</label>
        <select
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-[11px] text-white focus:border-studio-accent/60 focus:outline-none"
          value={targetSequenceId}
          onChange={(e) => setTargetSequenceId(e.target.value)}
          aria-label="Target branch sequence"
        >
          <option value="">— select branch —</option>
          {sequences.map((seq) => (
            <option key={seq.id} value={seq.id}>
              {seq.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!elementKey || !targetSequenceId}
          className="px-3 py-1.5 rounded bg-studio-accent/80 hover:bg-studio-accent text-white text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleMakeHotspot}
        >
          Make hotspot
        </button>
      </div>

      {hotspots.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-neutral-400 font-medium">Hotspots on this slide</p>
          {hotspots.map((h) => {
            const seqLabel = sequences.find((s) => s.id === h.target)?.label ?? h.target;
            return (
              <div key={h.id} className="flex items-center gap-2 bg-neutral-800 rounded px-2 py-1">
                <span className="flex-1 text-[11px] text-neutral-200 truncate">
                  {h.label} → <span className="text-neutral-400">{seqLabel}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove hotspot ${h.label}`}
                  className="text-[10px] text-neutral-500 hover:text-red-400 transition-colors"
                  onClick={() => onRemoveHotspot(selectedSceneId, h.id)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
