import { useEffect, useState } from "react";
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

export function VstSection({
  projectId,
  element,
  onSetAttribute,
  vstHost,
}: {
  projectId: string;
  element: DomEditSelection;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  vstHost: VstHostApi | null;
}) {
  const chainPath = element.dataAttributes["vst-chain"] || null;
  const [chain, setChain] = useState<ChainFileJson | null>(null);
  const [busy, setBusy] = useState(false);

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
                onClick={() => vstHost.openEditor(vstElementId(element), index)}
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
