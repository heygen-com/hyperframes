/**
 * SlideshowPanel — Studio right-panel tab for authoring the slideshow island.
 *
 * Four sub-surfaces:
 *   1. Slide list: scenes → toggle main-line slide; reorder via up/down arrows.
 *   2. Slide inspector: notes textarea; fragment hold-points.
 *   3. Branch tree: create/rename sequences; assign scenes to a branch.
 *   4. Hotspot tool: mark selected element as a hotspot on the active slide.
 *
 * State: the manifest is parsed from the current composition HTML on mount and
 * on each `compHtml` change. Every edit calls `onPersist(manifest)` and
 * updates local state.
 *
 * All manifest transforms are pure helpers — see slideshowPanelHelpers.ts.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { parseSlideshowManifest } from "@hyperframes/core/slideshow";
import type { SlideshowManifest, SlideHotspot } from "@hyperframes/core/slideshow";
import { usePlayerStore } from "../../player";
import { useDomEditSelectionContext } from "../../contexts/DomEditContext";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { generateId } from "../../utils/generateId";
import {
  SectionHeader,
  SlideList,
  SlideInspector,
  BranchTree,
  HotspotTool,
} from "./SlideshowSubPanels";

// Re-export pure helpers so the test file can import from "./SlideshowPanel".
export {
  toggleMainLineSlide,
  reorderMainLineSlide,
  reorderBranchSlide,
  setSlideNotes,
  addFragment,
  removeFragment,
  createSequence,
  renameSequence,
  deleteSequence,
  assignToBranch,
  addHotspot,
  removeHotspot,
} from "./slideshowPanelHelpers";
export type { SceneInfo } from "./slideshowPanelHelpers";

export function safeParseManifest(html: string): SlideshowManifest {
  try {
    return parseSlideshowManifest(html) ?? { slides: [] };
  } catch {
    return { slides: [] };
  }
}

import {
  toggleMainLineSlide,
  reorderMainLineSlide,
  setSlideNotes,
  addFragment,
  removeFragment,
  createSequence,
  renameSequence,
  deleteSequence,
  assignToBranch,
  addHotspot,
  removeHotspot,
} from "./slideshowPanelHelpers";

// ── Notes-attribution controller (pure, testable) ─────────────────────────
//
// The React component delegates debounce scheduling to these functions so
// the flush-attribution invariant can be tested without a DOM or React renderer.

export interface NotesController {
  /** Record a notes keystroke; returns the timer id. */
  schedule: (
    manifest: SlideshowManifest,
    persist: (m: SlideshowManifest) => Promise<void>,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  /** Flush any pending notes synchronously (e.g. on comp-switch or unmount). */
  flush: () => void;
  /** Cancel without flushing (used when a discrete action absorbs the notes). */
  cancel: () => void;
  /** Merge any pending notes into an incoming discrete manifest, then clear. */
  mergeIntoDiscrete: (next: SlideshowManifest) => SlideshowManifest;
}

export function makeSlideshowNotesController(): NotesController {
  type Pending = { manifest: SlideshowManifest; persist: (m: SlideshowManifest) => Promise<void> };
  let pending: Pending | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Atomically swap the pending entry out and fire its persist (if any).
  // Used by both the debounce timer's tail and the explicit flush() path.
  const drainPending = (): void => {
    const p = pending;
    if (p === null) return;
    pending = null;
    p.persist(p.manifest).catch((err: unknown) => {
      console.error("[slideshow] notes persist failed:", err);
    });
  };

  return {
    schedule(manifest, persist, delayMs) {
      if (timer !== null) clearTimeout(timer);
      pending = { manifest, persist };
      timer = setTimeout(() => {
        timer = null;
        drainPending();
      }, delayMs);
      return timer;
    },

    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      drainPending();
    },

    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },

    mergeIntoDiscrete(next) {
      const p = pending;
      if (p === null) return next;
      pending = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      return {
        ...next,
        slides: next.slides.map((slide) => {
          const ps = p.manifest.slides.find((s) => s.sceneId === slide.sceneId);
          if (ps?.notes !== undefined && slide.notes === undefined) {
            return { ...slide, notes: ps.notes };
          }
          return slide;
        }),
      };
    },
  };
}

// ── Component ─────────────────────────────────────────────────────────────

export interface SlideshowPanelProps {
  /** Scenes from the live clip manifest (passed from StudioRightPanel). */
  scenes: import("./slideshowPanelHelpers").SceneInfo[];
  /**
   * Called with the updated manifest after every discrete edit (toggle, add,
   * delete, reorder, hotspot).  Notes changes use the debounced variant instead.
   */
  onPersist: (manifest: SlideshowManifest) => Promise<void>;
  /** Called with the updated manifest after the notes idle delay (~450 ms). */
  onPersistNotes: (manifest: SlideshowManifest) => Promise<void>;
}

type SectionKey = "slides" | "inspector" | "branches" | "hotspot";

export function SlideshowPanel({ scenes, onPersist, onPersistNotes }: SlideshowPanelProps) {
  const { editingFile } = useFileManagerContext();
  const compHtml = editingFile?.content ?? null;

  const [manifest, setManifest] = useState<SlideshowManifest>(() => {
    if (!compHtml) return { slides: [] };
    return safeParseManifest(compHtml);
  });

  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(
    () => new Set<SectionKey>(["slides", "inspector"]),
  );

  const currentTime = usePlayerStore((s) => s.currentTime);
  const { domEditSelection } = useDomEditSelectionContext();

  // Keep a ref to the latest manifest so discrete handlers always operate on
  // the freshest state, never a stale closure snapshot.
  const manifestRef = useRef<SlideshowManifest>(manifest);

  // Controller pairs each pending notes update with the callback that owns it,
  // so a flush always writes to the composition the notes were typed in.
  const notesCtrlRef = useRef<NotesController>(makeSlideshowNotesController());

  useEffect(() => {
    if (!compHtml) {
      // Flush any pending notes for the OLD composition before clearing state.
      notesCtrlRef.current.flush();
      setManifest({ slides: [] });
      manifestRef.current = { slides: [] };
      return;
    }
    const parsed = safeParseManifest(compHtml);
    // Flush pending notes for the OLD composition before switching to the new one.
    notesCtrlRef.current.flush();
    setManifest(parsed);
    manifestRef.current = parsed;
    setSelectedSequenceId(null);
  }, [compHtml]);

  /** Discrete actions (toggle, reorder, add/delete, hotspot): persist immediately. */
  const applyManifest = useCallback(
    async (next: SlideshowManifest) => {
      // Fold any in-flight typed notes into the discrete manifest so they are
      // not silently dropped when the debounce timer would have fired later.
      const merged = notesCtrlRef.current.mergeIntoDiscrete(next);
      setManifest(merged);
      manifestRef.current = merged;
      // Surface persist failures instead of swallowing them at each call site.
      try {
        await onPersist(merged);
      } catch (err) {
        console.error("[slideshow] failed to persist manifest edit:", err);
      }
    },
    [onPersist],
  );

  /**
   * Notes path: update in-memory state immediately for a responsive UI, but
   * debounce the disk persist to ~450 ms after the last keystroke.  The pending
   * notes are paired with the callback that owns them (the one bound to the
   * current composition path), so a composition switch before the timer fires
   * will flush to the correct file.
   */
  const applyNotesManifest = useCallback(
    (next: SlideshowManifest) => {
      setManifest(next);
      manifestRef.current = next;
      notesCtrlRef.current.schedule(next, onPersistNotes, 450);
    },
    [onPersistNotes],
  );

  // Flush any pending notes persist when the component unmounts so we never
  // silently drop an edit the user made right before navigating away.
  useEffect(() => {
    const ctrl = notesCtrlRef.current;
    return () => {
      ctrl.flush();
    };
  }, []);

  const toggleSection = useCallback((key: SectionKey) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const activeSlides = selectedSequenceId
    ? ((manifest.slideSequences ?? []).find((s) => s.id === selectedSequenceId)?.slides ?? [])
    : manifest.slides;
  const selectedSlide = activeSlides.find((s) => s.sceneId === selectedSceneId);
  const sequences = manifest.slideSequences ?? [];

  const handleSelectBranchSlide = useCallback((sequenceId: string, sceneId: string) => {
    setSelectedSceneId(sceneId);
    setSelectedSequenceId(sequenceId);
  }, []);

  const handleToggleSlide = useCallback(
    (sceneId: string) => {
      applyManifest(toggleMainLineSlide(manifestRef.current, sceneId)).catch(() => {});
    },
    [applyManifest],
  );

  const handleReorder = useCallback(
    (sceneId: string, dir: "up" | "down") => {
      applyManifest(reorderMainLineSlide(manifestRef.current, sceneId, dir)).catch(() => {});
    },
    [applyManifest],
  );

  const handleSetNotes = useCallback(
    (notes: string) => {
      if (!selectedSceneId) return;
      applyNotesManifest(
        setSlideNotes(manifestRef.current, selectedSceneId, notes, selectedSequenceId ?? undefined),
      );
    },
    [selectedSceneId, selectedSequenceId, applyNotesManifest],
  );

  const handleMarkFragment = useCallback(() => {
    if (!selectedSceneId) return;
    applyManifest(
      addFragment(
        manifestRef.current,
        selectedSceneId,
        currentTime,
        selectedSequenceId ?? undefined,
      ),
    ).catch(() => {});
  }, [selectedSceneId, selectedSequenceId, currentTime, applyManifest]);

  const handleRemoveFragment = useCallback(
    (time: number) => {
      if (!selectedSceneId) return;
      applyManifest(
        removeFragment(manifestRef.current, selectedSceneId, time, selectedSequenceId ?? undefined),
      ).catch(() => {});
    },
    [selectedSceneId, selectedSequenceId, applyManifest],
  );

  const handleCreateSequence = useCallback(
    (label: string) => {
      const id = `seq-${generateId()}`;
      applyManifest(createSequence(manifestRef.current, id, label)).catch(() => {});
    },
    [applyManifest],
  );

  const handleRenameSequence = useCallback(
    (id: string, label: string) => {
      applyManifest(renameSequence(manifestRef.current, id, label)).catch(() => {});
    },
    [applyManifest],
  );

  const handleDeleteSequence = useCallback(
    (id: string) => {
      // Deleting a branch removes its slides and orphans any hotspot targeting it —
      // confirm first to prevent accidental data loss.
      const seq = (manifestRef.current.slideSequences ?? []).find((s) => s.id === id);
      const count = seq?.slides.length ?? 0;
      const label = seq?.label ?? id;
      const ok = window.confirm(
        `Delete branch "${label}"${count ? ` and its ${count} slide${count === 1 ? "" : "s"}` : ""}? ` +
          `Hotspots pointing to it will no longer resolve.`,
      );
      if (!ok) return;
      applyManifest(deleteSequence(manifestRef.current, id)).catch(() => {});
    },
    [applyManifest],
  );

  const handleAssign = useCallback(
    (sequenceId: string, sceneId: string, assign: boolean) => {
      applyManifest(assignToBranch(manifestRef.current, sequenceId, sceneId, assign)).catch(
        () => {},
      );
    },
    [applyManifest],
  );

  const handleAddHotspot = useCallback(
    (sceneId: string, hotspot: SlideHotspot) => {
      applyManifest(
        addHotspot(manifestRef.current, sceneId, hotspot, selectedSequenceId ?? undefined),
      ).catch(() => {});
    },
    [selectedSequenceId, applyManifest],
  );

  const handleRemoveHotspot = useCallback(
    (sceneId: string, hotspotId: string) => {
      applyManifest(
        removeHotspot(manifestRef.current, sceneId, hotspotId, selectedSequenceId ?? undefined),
      ).catch(() => {});
    },
    [selectedSequenceId, applyManifest],
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto text-white">
      <SectionHeader
        expanded={expandedSections.has("slides")}
        onToggle={() => toggleSection("slides")}
      >
        Slides ({manifest.slides.length})
      </SectionHeader>
      {expandedSections.has("slides") && (
        <div className="py-1">
          <SlideList
            scenes={scenes}
            slides={manifest.slides}
            selectedSceneId={selectedSceneId}
            onSelect={(id) => {
              setSelectedSceneId(id);
              setSelectedSequenceId(null);
            }}
            onToggle={handleToggleSlide}
            onReorder={handleReorder}
          />
        </div>
      )}

      <SectionHeader
        expanded={expandedSections.has("inspector")}
        onToggle={() => toggleSection("inspector")}
      >
        Slide Inspector
      </SectionHeader>
      {expandedSections.has("inspector") && (
        <>
          {selectedSceneId ? (
            <SlideInspector
              sceneId={selectedSceneId}
              slide={selectedSlide}
              currentTime={currentTime}
              onSetNotes={handleSetNotes}
              onMarkFragment={handleMarkFragment}
              onRemoveFragment={handleRemoveFragment}
            />
          ) : (
            <p className="px-3 py-2 text-[11px] text-neutral-500 italic">
              Select a scene above to inspect
            </p>
          )}
        </>
      )}

      <SectionHeader
        expanded={expandedSections.has("branches")}
        onToggle={() => toggleSection("branches")}
      >
        Branches ({sequences.length})
      </SectionHeader>
      {expandedSections.has("branches") && (
        <BranchTree
          sequences={sequences}
          scenes={scenes}
          onCreateSequence={handleCreateSequence}
          onRenameSequence={handleRenameSequence}
          onDeleteSequence={handleDeleteSequence}
          onAssign={handleAssign}
          selectedSceneId={selectedSceneId}
          selectedSequenceId={selectedSequenceId}
          onSelectBranchSlide={handleSelectBranchSlide}
        />
      )}

      <SectionHeader
        expanded={expandedSections.has("hotspot")}
        onToggle={() => toggleSection("hotspot")}
      >
        Hotspot Tool
      </SectionHeader>
      {expandedSections.has("hotspot") && (
        <HotspotTool
          selectedSceneId={selectedSceneId}
          slide={selectedSlide}
          domEditSelection={domEditSelection}
          sequences={sequences}
          onAddHotspot={handleAddHotspot}
          onRemoveHotspot={handleRemoveHotspot}
        />
      )}
    </div>
  );
}
