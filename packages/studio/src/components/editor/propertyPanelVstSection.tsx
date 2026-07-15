import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Zap } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import { Section } from "./propertyPanelPrimitives";
import {
  isRecord,
  parseChainFile,
  serializeChainFile,
  type ChainFileJson,
  type ChainPluginJson,
} from "../../utils/vstChainFile";

/** A plugin the sidecar found on disk during a filesystem scan (Task 12's `useVstHost`). */
export interface VstRegistryEntry {
  path: string;
  name: string;
  format: string;
}

/**
 * Consumed by this section; the real implementation is a Task 12 hook that
 * talks to the sidecar over a WebSocket. `null` means the sidecar isn't
 * running/installed.
 */
export interface VstHostApi {
  registry: VstRegistryEntry[];
  scan(): Promise<void>;
  openEditor(trackId: string, pluginIndex: number): void;
  /** Resolves with the sidecar-assigned wire `trackIndex` for `trackId` (see useVstHost's `assignNextTrackIndex`). */
  loadChain(trackId: string, chain: ChainFileJson, wavUrl: string): Promise<number>;
  getState(trackId: string): Promise<string[]>;
}

function readFileContent(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.content === "string" ? value.content : null;
}

function normalizePluginFormat(format: string): ChainPluginJson["format"] {
  return format === "vst3" || format === "au" ? format : "builtin";
}

function vstElementId(element: DomEditSelection): string {
  return element.id ?? element.hfId ?? "element";
}

function chainFilePath(element: DomEditSelection): string {
  return `fx/${vstElementId(element)}.vstchain.json`;
}

async function readChainFile(projectId: string, path: string): Promise<ChainFileJson | null> {
  const response = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`);
  if (!response.ok) return null;
  const content = readFileContent(await response.json());
  if (content === null) return null;
  return parseChainFile(content);
}

async function writeChainFile(
  projectId: string,
  path: string,
  chain: ChainFileJson,
): Promise<boolean> {
  const response = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: serializeChainFile(chain),
  });
  return response.ok;
}

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

  // Diffing/writing target for the poller below — mutated in place every
  // render so the poll tick (and its unmount/navigate-away flush) always
  // reads the latest known chain without needing to be in the polling
  // effect's dependency array (which would restart the interval on every
  // add/remove/persist).
  const chainRef = useRef<ChainFileJson | null>(null);
  chainRef.current = chain;
  const busyRef = useRef(busy);
  busyRef.current = busy;
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

  // A different selected element/track means any editor presumed open
  // belonged to the PREVIOUS track — stop treating one as open here (the
  // polling effect below still gets one final best-effort flush for the old
  // track via its own cleanup, since chainPath changing also tears it down).
  useEffect(() => {
    setEditorOpen(false);
  }, [chainPath]);

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

  const handleAddEffect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let registry = vstHost.registry;
      if (registry.length === 0) {
        await vstHost.scan();
        registry = vstHost.registry;
      }
      const candidate = registry[0];
      if (!candidate) return;
      const newChain: ChainFileJson = {
        version: 1,
        plugins: [
          {
            format: normalizePluginFormat(candidate.format),
            path: candidate.path,
            pluginName: candidate.name,
            name: candidate.name,
            stateB64: null,
          },
        ],
      };
      const path = chainFilePath(element);
      const ok = await writeChainFile(projectId, path, newChain);
      if (!ok) return;
      if (domEditSaveTimestampRef) domEditSaveTimestampRef.current = Date.now();
      setChain(newChain);
      await onSetAttribute("vst-chain", path);
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="VST FX" icon={<Zap size={15} />}>
      <div className="space-y-2">
        {!chainPath && (
          <button
            type="button"
            data-vst-add-effect="true"
            disabled={busy}
            onClick={() => {
              void handleAddEffect();
            }}
            className="flex h-8 items-center gap-1.5 rounded-md bg-panel-input px-2.5 text-[11px] font-medium text-panel-text-2 transition-colors hover:bg-panel-hover hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>Add effect</span>
          </button>
        )}

        {chainPath && chain && chain.plugins.length === 0 && (
          <div className="text-[11px] text-panel-text-4">No effects in this chain.</div>
        )}

        {chainPath &&
          chain?.plugins.map((plugin, index) => (
            <div
              key={`${plugin.path}-${index}`}
              data-vst-plugin-row="true"
              className="flex items-center justify-between gap-2 rounded-md bg-panel-input/30 p-2"
            >
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-panel-text-2">
                {plugin.name}
              </span>
              <button
                type="button"
                data-vst-open-editor="true"
                onClick={() => {
                  vstHost.openEditor(trackId, index);
                  setEditorOpen(true);
                }}
                className="h-7 flex-shrink-0 rounded-md px-2 text-[10px] font-medium text-panel-text-3 hover:bg-panel-hover"
              >
                Open editor
              </button>
              <button
                type="button"
                data-vst-remove-plugin="true"
                disabled={busy}
                onClick={() => {
                  void handleRemovePlugin(index);
                }}
                className="h-7 flex-shrink-0 rounded-md px-2 text-[10px] font-medium text-panel-text-3 hover:bg-panel-hover disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
      </div>
    </Section>
  );
}
