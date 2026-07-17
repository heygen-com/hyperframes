import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Zap } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import { Section } from "./propertyPanelPrimitives";
import { usePlayerStore } from "../../player/store/playerStore";
import type { ChainFileJson } from "../../utils/vstChainFile";
import {
  decodeBuiltinParams,
  encodeBuiltinParams,
  normalizePluginFormat,
  vstElementId,
  chainFilePath,
  readChainFile,
  writeChainFile,
  type LoadChainResult,
  type VstHostApi,
  type VstRegistryEntry,
} from "./propertyPanelVstShared";
import { VstCarveSection } from "./propertyPanelVstCarveSection";
import { VstPluginRows } from "./propertyPanelVstPluginRows";

export type { LoadChainResult, VstHostApi, VstRegistryEntry };

/**
 * Finding 1 (final whole-branch review): a native plugin editor window edits
 * the sidecar's live in-memory plugin instance directly — there is no
 * "editor was closed" event on the wire (the native window closes via its
 * own OS chrome, not our WebSocket protocol; `close-editor` is a
 * client-initiated no-op, see useVstHost). Without persistence, the chain
 * file keeps whatever `stateB64` it had before the user opened the editor,
 * so `hyperframes render` would silently bounce stale/default plugin state
 * instead of what the user actually heard in preview.
 *
 * Fix: while an editor is presumed open for this track (since the last
 * `openEditor` click, until the track/chain changes or this section
 * unmounts), poll `vstHost.getState` and persist any diff to the chain file
 * via the same `writeChainFile` PUT `handleAddEffect`/`handleRemovePlugin`
 * already use. 2.5s is a compromise: short enough that the state-loss
 * window if the studio process dies right after a tweak is small, long
 * enough to not hammer the project file store with PUTs while a knob is
 * being dragged continuously (dragging doesn't need every intermediate
 * value persisted — only the settled result before a render).
 */
const VST_STATE_POLL_INTERVAL_MS = 2500;

/** Max attempts the param-seed poll below (`seed` in the effect that keys off
 *  `pluginSig`) makes before giving up on the sidecar's live state settling. */
const SEED_MAX_TRIES = 8;

/** Schedules one more seed-poll attempt, unless the effect was cancelled
 *  (unmount / dep change) or the retry budget is exhausted. */
function scheduleSeedRetry(cancelled: boolean, tries: number, retry: () => void): void {
  if (!cancelled && tries < SEED_MAX_TRIES) setTimeout(retry, 400);
}

/** Decodes each built-in plugin's live sidecar state into its editable param
 *  map (external VST3/AU plugins stay `null` — their state is opaque, see the
 *  `paramsByPlugin` doc-comment). */
function decodeSeedStates(
  current: ChainFileJson,
  states: string[],
): (Record<string, number> | null)[] {
  return current.plugins.map((p, i) =>
    p.format === "builtin" ? (decodeBuiltinParams(states[i]) ?? {}) : null,
  );
}

export function VstSection({
  projectId,
  element,
  onSetAttribute,
  vstHost,
  domEditSaveTimestampRef,
}: {
  projectId: string;
  element: DomEditSelection;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  vstHost: VstHostApi | null;
  /** Stamped after every chain-file write so the studio's file-watcher
   *  treats it as our own save and skips reloading the preview — every
   *  other save path in the app does this; the poller below must too. */
  domEditSaveTimestampRef?: MutableRefObject<number>;
}) {
  const trackId = vstElementId(element);
  const chainPath = element.dataAttributes["vst-chain"] || null;
  const [chain, setChain] = useState<ChainFileJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // The effects offered by the "Add effect" picker: pedalboard's built-ins
  // plus any installed VST3/AU the sidecar found (see useVstHost's `scan`).
  const [available, setAvailable] = useState<VstRegistryEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  // One scan per mount, regardless of how often `vstHost`'s identity churns
  // (its `registry` is a ref, so this effect can't just read it reactively).
  const scanRequestedRef = useRef(false);
  // Editable parameter values per plugin (null for external plugins, whose
  // state is opaque — they keep the native editor). Seeded from the sidecar's
  // live state so freshly-added built-ins show their real defaults.
  const [paramsByPlugin, setParamsByPlugin] = useState<(Record<string, number> | null)[]>([]);
  const paramPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Diffing/writing target for the poller below — mutated in place every
  // render so the poll tick (and its unmount/navigate-away flush) always
  // reads the latest known chain without needing to be in the polling
  // effect's dependency array (which would restart the interval on every
  // add/remove/persist).
  const chainRef = useRef<ChainFileJson | null>(null);
  chainRef.current = chain;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const paramsByPluginRef = useRef(paramsByPlugin);
  paramsByPluginRef.current = paramsByPlugin;
  // Structural signature of the chain (formats + paths, NOT param values), so
  // the param-seed effect re-runs on add/remove/swap but not on a param edit.
  const pluginSig = (chain?.plugins ?? []).map((p) => `${p.format}:${p.path}`).join("|");
  const persistingRef = useRef(false);

  useEffect(() => {
    if (!chainPath) {
      setChain(null);
      return;
    }
    let cancelled = false;
    void readChainFile(projectId, chainPath).then((loaded) => {
      if (!cancelled) setChain(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, chainPath]);

  // Populate the "Add effect" picker. Built-ins come back instantly with the
  // scan; installed VST3/AU are discovered by the (subprocess-guarded) disk
  // probe. `registry` is a live ref on the host, so we copy it into local
  // state to render options. Runs whether or not the element already has a
  // chain — adding a SECOND effect appends to the existing chain, so the
  // picker must stay populated past the first add.
  useEffect(() => {
    if (!vstHost) return;
    if (vstHost.registry.length > 0) {
      setAvailable([...vstHost.registry]);
      return;
    }
    if (scanRequestedRef.current) return;
    scanRequestedRef.current = true;
    setScanning(true);
    void vstHost
      .scan()
      .catch(() => {})
      .finally(() => {
        setAvailable([...vstHost.registry]);
        setScanning(false);
      });
  }, [vstHost]);

  // A different selected element/track means any editor presumed open
  // belonged to the PREVIOUS track — stop treating one as open here (the
  // polling effect below still gets one final best-effort flush for the old
  // track via its own cleanup, since chainPath changing also tears it down).
  useEffect(() => {
    setEditorOpen(false);
  }, [chainPath]);

  // Seed editable params for built-in plugins from the sidecar's LIVE state
  // (so a freshly-added effect shows its real defaults). Retries briefly — the
  // preview may still be loading the chain into the sidecar on first run.
  // Keyed on `pluginSig` (structure), so param edits don't re-seed and clobber.
  useEffect(() => {
    if (!vstHost || !chainPath) return;
    const initial = chainRef.current;
    if (!initial) return;
    if (!initial.plugins.some((p) => p.format === "builtin")) {
      setParamsByPlugin(initial.plugins.map(() => null));
      return;
    }
    let cancelled = false;
    let tries = 0;
    let lastJson = "";
    const seed = async (): Promise<void> => {
      tries += 1;
      let states: string[];
      try {
        states = await vstHost.getState(trackId);
      } catch {
        scheduleSeedRetry(cancelled, tries, () => void seed());
        return;
      }
      if (cancelled) return;
      const current = chainRef.current;
      if (!current || states.length !== current.plugins.length) {
        scheduleSeedRetry(false, tries, () => void seed());
        return;
      }
      const decoded = decodeSeedStates(current, states);
      setParamsByPlugin(decoded);
      // The sidecar's live state lags the panel's chain write while
      // useVstPreview reloads the track, so the first read right after a swap
      // still returns the PREVIOUS effect's params. Keep polling until two
      // reads agree (reload settled), converging the sliders onto the new one.
      const json = JSON.stringify(decoded);
      if (json !== lastJson) {
        lastJson = json;
        scheduleSeedRetry(false, tries, () => void seed());
      }
    };
    void seed();
    return () => {
      cancelled = true;
    };
  }, [vstHost, chainPath, pluginSig, trackId]);

  // Finding 1: persist native-editor edits. See VST_STATE_POLL_INTERVAL_MS's
  // doc-comment for why polling (vs. an on-close event) and why this
  // interval.
  useEffect(() => {
    if (!editorOpen || !chainPath || !vstHost) return;

    // fallow-ignore-next-line complexity
    const persistIfChanged = async (): Promise<void> => {
      if (busyRef.current || persistingRef.current) return;
      const current = chainRef.current;
      if (!current || current.plugins.length === 0) return;
      persistingRef.current = true;
      try {
        let states: string[];
        try {
          states = await vstHost.getState(trackId);
        } catch {
          return; // sidecar unreachable this tick — try again next tick
        }
        // Only matches when every plugin in the chain is currently loaded in
        // the sidecar, in the same order — anything else is ambiguous, so
        // skip rather than guess at an index mapping.
        if (states.length !== current.plugins.length) return;
        if (current.plugins.every((plugin, i) => plugin.stateB64 === states[i])) return;
        const nextChain: ChainFileJson = {
          version: 1,
          plugins: current.plugins.map((plugin, i) => ({ ...plugin, stateB64: states[i] })),
        };
        const ok = await writeChainFile(projectId, chainPath, nextChain);
        if (ok) {
          chainRef.current = nextChain;
          if (domEditSaveTimestampRef) domEditSaveTimestampRef.current = Date.now();
        }
      } finally {
        persistingRef.current = false;
      }
    };

    const interval = setInterval(() => {
      void persistIfChanged();
    }, VST_STATE_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      // Best-effort flush: the section is unmounting, or the user navigated
      // to a different element/track — save whatever state we can read
      // right now instead of losing up to VST_STATE_POLL_INTERVAL_MS of
      // edits. Skipped (persistingRef guard above) if a tick happens to
      // already be in flight — acceptable for a best-effort save.
      void persistIfChanged();
    };
  }, [editorOpen, chainPath, projectId, trackId, vstHost, domEditSaveTimestampRef]);

  if (!vstHost) {
    return (
      <Section title="VST FX" icon={<Zap size={15} />}>
        <div className="text-[11px] text-panel-text-4" data-vst-install-hint="true">
          VST host not available — install with{" "}
          <code className="text-panel-text-3">uv tool install hyperframes-vst-host</code>
        </div>
      </Section>
    );
  }

  // Persist the current param values into the chain file so they survive a
  // reload. Debounced from `handleParamChange` (dragging fires many changes);
  // the live audio is already updated via `setParam` on every change.
  const persistParams = async (): Promise<void> => {
    const current = chainRef.current;
    if (!current || !chainPath) return;
    const next: ChainFileJson = {
      version: 1,
      plugins: current.plugins.map((plugin, i) => {
        const params = paramsByPluginRef.current[i];
        return plugin.format === "builtin" && params
          ? { ...plugin, stateB64: encodeBuiltinParams(params) }
          : plugin;
      }),
    };
    const ok = await writeChainFile(projectId, chainPath, next);
    if (ok) {
      chainRef.current = next;
      setChain(next);
      if (domEditSaveTimestampRef) domEditSaveTimestampRef.current = Date.now();
    }
  };

  const handleParamChange = (pluginIndex: number, param: string, value: number) => {
    // Apply to the live streaming plugin immediately (audible now)...
    vstHost.setParam(trackId, pluginIndex, param, value);
    // ...update the visible control...
    setParamsByPlugin((prev) => {
      const next = prev.slice();
      const cur = next[pluginIndex];
      if (cur) next[pluginIndex] = { ...cur, [param]: value };
      return next;
    });
    // ...and debounce a write so the value persists across reloads.
    if (paramPersistTimerRef.current) clearTimeout(paramPersistTimerRef.current);
    paramPersistTimerRef.current = setTimeout(() => void persistParams(), 400);
  };

  const handleAddPlugin = async (candidate: VstRegistryEntry) => {
    if (busy) return;
    setBusy(true);
    try {
      const format = normalizePluginFormat(candidate.format);
      // Append to any existing chain (effects stack in series, applied in
      // order) — the first add starts a fresh chain, later adds grow it.
      const newChain: ChainFileJson = {
        version: 1,
        plugins: [
          ...(chain?.plugins ?? []),
          {
            format,
            path: candidate.path,
            // Built-ins have no sub-plugin name (their `path` IS the class);
            // only external VST3/AU bundles carry one for `load_plugin`.
            pluginName: format === "builtin" ? null : candidate.name,
            name: candidate.name,
            stateB64: null,
          },
        ],
      };
      const path = chainPath ?? chainFilePath(element);
      const ok = await writeChainFile(projectId, path, newChain);
      if (!ok) return;
      if (domEditSaveTimestampRef) domEditSaveTimestampRef.current = Date.now();
      setChain(newChain);
      if (!chainPath) await onSetAttribute("vst-chain", path);
      // Tell useVstPreview to reconcile+reload — a chain-file rewrite is
      // invisible to the timeline `elements` signal it otherwise watches.
      usePlayerStore.getState().bumpVstChainRevision();
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePlugin = async (index: number) => {
    if (!chain || !chainPath || busy) return;
    setBusy(true);
    try {
      const nextPlugins = chain.plugins.filter((_, i) => i !== index);
      const nextChain: ChainFileJson = { version: 1, plugins: nextPlugins };
      const ok = await writeChainFile(projectId, chainPath, nextChain);
      if (!ok) return;
      if (domEditSaveTimestampRef) domEditSaveTimestampRef.current = Date.now();
      setChain(nextChain);
      if (nextPlugins.length === 0) {
        // The commit path (`handleDomAttributeCommit`) types `value` as `string`,
        // not `string | null` — "" is the established sentinel this panel uses
        // to drop a data-* attribute's meaning (see MediaSection's `has-audio`).
        await onSetAttribute("vst-chain", "");
      }
      usePlayerStore.getState().bumpVstChainRevision();
    } finally {
      setBusy(false);
    }
  };

  // Seed the visible param sliders from a chain written outside the normal
  // param-edit path (currently: the carve control) — the sidecar-polling
  // seed effect is keyed on chain STRUCTURE, so it won't re-fire for a
  // same-structure rewrite and the sliders would otherwise keep showing
  // stale values.
  const handleChainWrittenExternally = (nextChain: ChainFileJson) => {
    setChain(nextChain);
    setParamsByPlugin(
      nextChain.plugins.map((p) =>
        p.format === "builtin" ? (decodeBuiltinParams(p.stateB64) ?? {}) : null,
      ),
    );
  };

  return (
    <Section title="VST FX" icon={<Zap size={15} />}>
      <div className="space-y-2">
        {/* Always rendered — a chain is a stack, so the picker stays
            available to append further effects after the first add. */}
        {scanning && available.length === 0 ? (
          <div className="text-[11px] text-panel-text-4">Finding effects…</div>
        ) : available.length === 0 ? (
          <div className="text-[11px] text-panel-text-4">No effects available.</div>
        ) : (
          <select
            data-vst-add-effect="true"
            disabled={busy}
            value=""
            onChange={(e) => {
              const picked = available[Number(e.target.value)];
              if (picked) void handleAddPlugin(picked);
            }}
            className="h-8 w-full rounded-md bg-panel-input px-2.5 text-[11px] font-medium text-panel-text-2 transition-colors hover:bg-panel-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="" disabled>
              Add effect…
            </option>
            {available.map((entry, i) => (
              <option key={`${entry.format}-${entry.path}-${entry.name}`} value={i}>
                {entry.name}
                {entry.format === "builtin" ? "" : ` (${entry.format.toUpperCase()})`}
              </option>
            ))}
          </select>
        )}

        {chainPath && chain && (
          <VstPluginRows
            chain={chain}
            chainPath={chainPath}
            projectId={projectId}
            trackId={trackId}
            vstHost={vstHost}
            paramsByPlugin={paramsByPlugin}
            busy={busy}
            setBusy={setBusy}
            setChain={setChain}
            domEditSaveTimestampRef={domEditSaveTimestampRef}
            onParamChange={handleParamChange}
            onOpenEditor={() => setEditorOpen(true)}
            onRemovePlugin={(index) => void handleRemovePlugin(index)}
          />
        )}

        <VstCarveSection
          projectId={projectId}
          element={element}
          trackId={trackId}
          busy={busy}
          setBusy={setBusy}
          onSetAttribute={onSetAttribute}
          onChainWritten={handleChainWrittenExternally}
          domEditSaveTimestampRef={domEditSaveTimestampRef}
        />
      </div>
    </Section>
  );
}
