import { type MutableRefObject } from "react";
import { usePlayerStore } from "../../player/store/playerStore";
import { isPluginEnabled, type ChainFileJson } from "../../utils/vstChainFile";
import {
  humanizeParam,
  paramRange,
  writeChainFile,
  type VstHostApi,
} from "./propertyPanelVstShared";

export interface VstPluginRowsProps {
  /** Non-null and non-empty-checked by the caller — this component only
   *  renders once a chain file has actually loaded for the element. */
  chain: ChainFileJson;
  chainPath: string;
  projectId: string;
  trackId: string;
  vstHost: VstHostApi;
  /** Editable parameter values per plugin (null for external plugins, whose
   *  state is opaque — they keep the native editor). */
  paramsByPlugin: (Record<string, number> | null)[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setChain: (chain: ChainFileJson) => void;
  /** Stamped after every chain-file write so the studio's file-watcher
   *  treats it as our own save and skips reloading the preview. */
  domEditSaveTimestampRef?: MutableRefObject<number>;
  onParamChange: (pluginIndex: number, param: string, value: number) => void;
  onOpenEditor: (index: number) => void;
  onRemovePlugin: (index: number) => void;
}

/** Renders the "Disable all/Enable all" button plus one row per plugin
 *  (bypass toggle, native editor launcher, remove, and — for built-ins —
 *  the live parameter sliders). */
export function VstPluginRows({
  chain,
  chainPath,
  projectId,
  trackId,
  vstHost,
  paramsByPlugin,
  busy,
  setBusy,
  setChain,
  domEditSaveTimestampRef,
  onParamChange,
  onOpenEditor,
  onRemovePlugin,
}: VstPluginRowsProps) {
  // Shared write path for the bypass toggles: persist the rewritten chain and
  // poke the preview to hot-reload it (bypass is applied by the sidecar's
  // processing board, so an audible change requires the chain reload).
  const persistChainRewrite = async (nextChain: ChainFileJson): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await writeChainFile(projectId, chainPath, nextChain);
      if (!ok) return;
      if (domEditSaveTimestampRef) domEditSaveTimestampRef.current = Date.now();
      setChain(nextChain);
      usePlayerStore.getState().bumpVstChainRevision();
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePlugin = async (index: number) => {
    await persistChainRewrite({
      version: 1,
      plugins: chain.plugins.map((plugin, i) =>
        i === index ? { ...plugin, enabled: !isPluginEnabled(plugin) } : plugin,
      ),
    });
  };

  const anyEnabled = chain.plugins.some(isPluginEnabled);

  const handleToggleAll = async () => {
    if (chain.plugins.length === 0) return;
    // Any enabled -> disable all (quick "hear it dry" A/B); all disabled ->
    // re-enable all.
    await persistChainRewrite({
      version: 1,
      plugins: chain.plugins.map((plugin) => ({ ...plugin, enabled: !anyEnabled })),
    });
  };

  if (chain.plugins.length === 0) {
    return <div className="text-[11px] text-panel-text-4">No effects in this chain.</div>;
  }

  return (
    <>
      <button
        type="button"
        data-vst-toggle-all="true"
        disabled={busy}
        onClick={() => {
          void handleToggleAll();
        }}
        className="h-7 w-full rounded-md bg-panel-input px-2.5 text-[10px] font-medium text-panel-text-3 transition-colors hover:bg-panel-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {anyEnabled ? "Disable all" : "Enable all"}
      </button>

      {chain.plugins.map((plugin, index) => {
        const params = paramsByPlugin[index] ?? null;
        const paramNames = params ? Object.keys(params) : [];
        const pluginEnabled = isPluginEnabled(plugin);
        return (
          <div
            key={`${plugin.path}-${index}`}
            data-vst-plugin-row="true"
            className={`rounded-md bg-panel-input/30 p-2${pluginEnabled ? "" : " opacity-50"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-panel-text-2">
                {plugin.name}
                {pluginEnabled ? "" : " (off)"}
              </span>
              <button
                type="button"
                data-vst-toggle-plugin="true"
                disabled={busy}
                onClick={() => {
                  void handleTogglePlugin(index);
                }}
                className="h-7 flex-shrink-0 rounded-md px-2 text-[10px] font-medium text-panel-text-3 hover:bg-panel-hover disabled:opacity-50"
              >
                {pluginEnabled ? "Disable" : "Enable"}
              </button>
              {/* Built-in effects have no native editor window (show_editor
                  is a VST3/AU-only concept) — offering the button would do
                  nothing. Only external plugins get it. */}
              {plugin.format !== "builtin" && (
                <button
                  type="button"
                  data-vst-open-editor="true"
                  onClick={() => {
                    vstHost.openEditor(trackId, index);
                    onOpenEditor(index);
                  }}
                  className="h-7 flex-shrink-0 rounded-md px-2 text-[10px] font-medium text-panel-text-3 hover:bg-panel-hover"
                >
                  Open editor
                </button>
              )}
              <button
                type="button"
                data-vst-remove-plugin="true"
                disabled={busy}
                onClick={() => {
                  onRemovePlugin(index);
                }}
                className="h-7 flex-shrink-0 rounded-md px-2 text-[10px] font-medium text-panel-text-3 hover:bg-panel-hover disabled:opacity-50"
              >
                Remove
              </button>
            </div>

            {paramNames.length > 0 && (
              <div className="mt-2 space-y-1.5" data-vst-params="true">
                {paramNames.map((name) => {
                  const [min, max, step] = paramRange(name);
                  const value = params?.[name] ?? 0;
                  return (
                    <label
                      key={name}
                      className="flex items-center gap-2 text-[10px] text-panel-text-3"
                    >
                      <span className="w-24 flex-shrink-0 truncate" title={name}>
                        {humanizeParam(name)}
                      </span>
                      <input
                        type="range"
                        data-vst-param={name}
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onChange={(e) => onParamChange(index, name, Number(e.target.value))}
                        className="h-1 flex-1 accent-panel-accent"
                      />
                      <span className="w-10 flex-shrink-0 text-right tabular-nums text-panel-text-2">
                        {Number.isInteger(step) ? value : value.toFixed(2)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
