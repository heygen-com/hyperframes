import { useEffect, useState, type MutableRefObject } from "react";
import type { DomEditSelection } from "./domEditing";
import { usePlayerStore } from "../../player/store/playerStore";
import {
  appendCarveBands,
  isRecord,
  projectRelativeAssetPath,
  type CarveBand,
  type ChainFileJson,
} from "../../utils/vstChainFile";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { chainFilePath, readChainFile, writeChainFile } from "./propertyPanelVstShared";

/** Maps the carve amount slider (0-100) to the sidecar's `maxCutDb` — 0 -> 2 dB
 *  (subtle), 100 -> 6 dB (aggressive). */
function amountToMaxCutDb(amount: number): number {
  return 2 + (amount / 100) * 4;
}

/** POSTs to `/vst/carve` and validates the response shape. Null on any failure
 *  (network, non-2xx, or malformed body) — the caller treats that as "no-op". */
async function fetchCarveBands(
  projectId: string,
  musicPath: string,
  voicePath: string,
  maxCutDb: number,
): Promise<CarveBand[] | null> {
  const res = await fetch("/api/vst/carve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, musicPath, voicePath, maxCutDb }),
  });
  if (!res.ok) return null;
  const body: unknown = await res.json().catch(() => null);
  return isRecord(body) && Array.isArray(body.bands) ? (body.bands as CarveBand[]) : null;
}

interface CarveRequest {
  projectId: string;
  element: DomEditSelection;
  musicSrc: string | undefined;
  voiceSrc: string | undefined;
  carveAmount: number;
}

interface CarveResult {
  chain: ChainFileJson;
  path: string;
}

/** Runs the full carve pipeline (resolve asset paths → fetch bands → merge
 *  into the chain file → write it back). Null on any failure — the caller
 *  treats that as "no-op" and leaves the panel open. */
async function runCarve(req: CarveRequest): Promise<CarveResult | null> {
  const musicSub = req.musicSrc ? projectRelativeAssetPath(req.musicSrc) : null;
  const voSub = req.voiceSrc ? projectRelativeAssetPath(req.voiceSrc) : null;
  if (!musicSub || !voSub) return null;

  const bands = await fetchCarveBands(
    req.projectId,
    musicSub,
    voSub,
    amountToMaxCutDb(req.carveAmount),
  );
  if (!bands) return null;

  const path = chainFilePath(req.element);
  const existing = await readChainFile(req.projectId, path);
  const nextChain = appendCarveBands(existing, bands);
  const ok = await writeChainFile(req.projectId, path, nextChain);
  if (!ok) return null;

  return { chain: nextChain, path };
}

export interface VstCarveSectionProps {
  projectId: string;
  element: DomEditSelection;
  trackId: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  /** Called with the freshly-written chain right after the PUT succeeds, so
   *  the parent can update its `chain` state and re-seed the visible param
   *  sliders (the amount slider must be reflected immediately — see the
   *  "re-applying carve" regression test). */
  onChainWritten: (chain: ChainFileJson) => void;
  /** Stamped after the write so the studio's file-watcher treats it as our
   *  own save and skips reloading the preview — every other save path in
   *  this panel does this too. */
  domEditSaveTimestampRef?: MutableRefObject<number>;
}

/** The "Make room for voiceover" carve control: renders nothing when there's
 *  no other audio track eligible as the voiceover source. */
export function VstCarveSection({
  projectId,
  element,
  trackId,
  busy,
  setBusy,
  onSetAttribute,
  onChainWritten,
  domEditSaveTimestampRef,
}: VstCarveSectionProps) {
  const elements = usePlayerStore((s) => s.elements);
  const [carveOpen, setCarveOpen] = useState(false);
  const [carveAmount, setCarveAmount] = useState(50);

  // Other audio tracks eligible as the voiceover source (exclude this track).
  const voCandidates = elements.filter(
    (el) => el.id !== trackId && isAudioTimelineElement(el) && Boolean(el.src),
  );
  const defaultVoId =
    voCandidates.find((el) => el.timelineRole === "voiceover")?.id ?? voCandidates[0]?.id ?? "";
  const [carveVoId, setCarveVoId] = useState(defaultVoId);
  // Keep the selection valid as tracks change / the panel first opens.
  useEffect(() => {
    if (!voCandidates.some((el) => el.id === carveVoId)) setCarveVoId(defaultVoId);
  }, [carveVoId, defaultVoId, voCandidates]);

  if (voCandidates.length === 0) return null;

  const handleCarve = async () => {
    if (busy) return;
    const music = elements.find((el) => el.id === trackId);
    const vo = voCandidates.find((el) => el.id === carveVoId);
    setBusy(true);
    try {
      const result = await runCarve({
        projectId,
        element,
        musicSrc: music?.src,
        voiceSrc: vo?.src,
        carveAmount,
      });
      if (!result) return;
      if (domEditSaveTimestampRef) domEditSaveTimestampRef.current = Date.now();
      // Seed the visible param sliders from what was just written (handled by
      // the parent via `onChainWritten`). The sidecar-polling seed effect is
      // keyed on the chain's STRUCTURE (formats + paths, deliberately — so
      // ordinary knob drags don't re-seed and clobber), but re-running carve
      // at a different amount keeps the same PeakFilter structure and only
      // changes gains — the effect never re-fires, and the rows kept
      // displaying the PREVIOUS run's values ("the amount slider does
      // nothing" when judged by the displayed numbers, even though the file
      // and the audio were right).
      onChainWritten(result.chain);
      await onSetAttribute("vst-chain", result.path);
      usePlayerStore.getState().bumpVstChainRevision();
      setCarveOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-panel-border pt-2">
      {!carveOpen ? (
        <button
          type="button"
          data-vst-carve-open="true"
          disabled={busy}
          onClick={() => setCarveOpen(true)}
          className="h-8 w-full rounded-md bg-panel-input px-2.5 text-[11px] font-medium text-panel-text-2 hover:bg-panel-hover disabled:opacity-50"
        >
          Make room for voiceover
        </button>
      ) : (
        <div className="space-y-2">
          <select
            data-vst-carve-voice="true"
            value={carveVoId}
            onChange={(e) => setCarveVoId(e.target.value)}
            className="h-8 w-full rounded-md bg-panel-input px-2.5 text-[11px] text-panel-text-2"
          >
            {voCandidates.map((el) => (
              <option key={el.id} value={el.id}>
                {el.id}
                {el.timelineRole === "voiceover" ? " (voiceover)" : ""}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[10px] text-panel-text-3">
            <span className="w-16 flex-shrink-0">Amount</span>
            <input
              type="range"
              data-vst-carve-amount="true"
              min={0}
              max={100}
              step={1}
              value={carveAmount}
              onChange={(e) => setCarveAmount(Number(e.target.value))}
              className="h-1 flex-1 accent-panel-accent"
            />
            <span className="w-8 text-right tabular-nums text-panel-text-2">{carveAmount}</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              data-vst-carve-apply="true"
              disabled={busy || !carveVoId}
              onClick={() => void handleCarve()}
              className="h-8 flex-1 rounded-md bg-panel-accent px-2.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setCarveOpen(false)}
              className="h-8 rounded-md px-2.5 text-[11px] text-panel-text-3 hover:bg-panel-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
