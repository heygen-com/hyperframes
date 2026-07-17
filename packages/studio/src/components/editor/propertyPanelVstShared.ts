import type { DomEditSelection } from "./domEditing";
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

export interface LoadChainResult {
  /** The sidecar-assigned wire `trackIndex` for this track (see useVstHost's `assignNextTrackIndex`). */
  trackIndex: number;
  /** The dry file's real sample rate — the sidecar streams PCM at this
   *  rate, not a fixed constant. The caller must create its AudioContext/
   *  AudioWorkletNode at this rate, or playback comes out at the wrong
   *  pitch and speed (and the drift-check misreads the resulting rate
   *  mismatch as ever-growing drift). */
  sampleRate: number;
  /** False when pedalboard can't host this chain without emitting NaN/Inf/
   *  runaway output (see the sidecar's `probe_chain_stability`). The caller
   *  must NOT stream or mute the track — it stays on its dry audio, with a
   *  warning — because a streamed unstable chain is silence at best. */
  stable: boolean;
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
  /** Sets a single plugin parameter on the live (streaming) instance — takes
   *  effect immediately, no reload. Fire-and-forget. */
  setParam(trackId: string, pluginIndex: number, param: string, value: number): void;
  loadChain(trackId: string, chain: ChainFileJson, wavUrl: string): Promise<LoadChainResult>;
  getState(trackId: string): Promise<string[]>;
}

function readFileContent(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.content === "string" ? value.content : null;
}

/** Sensible [min, max, step] per built-in parameter name (pedalboard built-ins
 *  don't expose ranges). Unknown names fall back to a 0..1 normalized slider. */
const PARAM_RANGES: Record<string, [number, number, number]> = {
  mix: [0, 1, 0.01],
  wet_level: [0, 1, 0.01],
  dry_level: [0, 1, 0.01],
  depth: [0, 1, 0.01],
  width: [0, 1, 0.01],
  damping: [0, 1, 0.01],
  room_size: [0, 1, 0.01],
  resonance: [0, 1, 0.01],
  feedback: [0, 1, 0.01],
  freeze_mode: [0, 1, 1],
  drive_db: [0, 60, 0.5],
  gain_db: [-40, 40, 0.5],
  threshold_db: [-100, 0, 0.5],
  semitones: [-24, 24, 1],
  bit_depth: [1, 16, 1],
  ratio: [1, 20, 0.1],
  delay_seconds: [0, 2, 0.01],
  rate_hz: [0, 20, 0.1],
  centre_delay_ms: [1, 50, 0.5],
  attack_ms: [0, 100, 0.5],
  release_ms: [0, 1000, 1],
  centre_frequency_hz: [20, 20000, 1],
  cutoff_frequency_hz: [20, 20000, 1],
  cutoff_hz: [20, 20000, 1],
  drive: [1, 30, 0.1],
};

export function paramRange(name: string): [number, number, number] {
  return PARAM_RANGES[name] ?? [0, 1, 0.01];
}

export function humanizeParam(name: string): string {
  return name.replace(/_/g, " ");
}

/** Built-in plugin state is base64(JSON of {param: number}); external plugins
 *  carry opaque raw_state, so only built-ins are decodable into an editable
 *  param map. Returns null for anything that isn't a plain number map. */
export function decodeBuiltinParams(
  stateB64: string | null | undefined,
): Record<string, number> | null {
  if (!stateB64) return null;
  try {
    const parsed: unknown = JSON.parse(atob(stateB64));
    if (!isRecord(parsed)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export function encodeBuiltinParams(params: Record<string, number>): string {
  return btoa(JSON.stringify(params));
}

export function normalizePluginFormat(format: string): ChainPluginJson["format"] {
  return format === "vst3" || format === "au" ? format : "builtin";
}

export function vstElementId(element: DomEditSelection): string {
  return element.id ?? element.hfId ?? "element";
}

export function chainFilePath(element: DomEditSelection): string {
  return `fx/${vstElementId(element)}.vstchain.json`;
}

export async function readChainFile(
  projectId: string,
  path: string,
): Promise<ChainFileJson | null> {
  const response = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`);
  if (!response.ok) return null;
  const content = readFileContent(await response.json());
  if (content === null) return null;
  return parseChainFile(content);
}

export async function writeChainFile(
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
