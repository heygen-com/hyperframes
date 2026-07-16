/**
 * On-disk `.vstchain.json` contract. Shared with the Python VST sidecar and
 * the CLI render pipeline — do not change field names/types here without
 * updating those consumers too.
 */
export interface ChainPluginJson {
  format: "vst3" | "au" | "builtin";
  path: string;
  pluginName: string | null;
  name: string;
  stateB64: string | null;
}

export interface ChainFileJson {
  version: 1;
  plugins: ChainPluginJson[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// fallow-ignore-next-line complexity
function isChainPluginJson(value: unknown): value is ChainPluginJson {
  if (!isRecord(value)) return false;
  const { format, path, pluginName, name, stateB64 } = value;
  if (format !== "vst3" && format !== "au" && format !== "builtin") return false;
  if (typeof path !== "string" || typeof name !== "string") return false;
  if (pluginName !== null && typeof pluginName !== "string") return false;
  if (stateB64 !== null && typeof stateB64 !== "string") return false;
  return true;
}

/** Parses a `.vstchain.json` file's text. Returns null on parse error, wrong version, or a malformed plugin entry. */
export function parseChainFile(text: string): ChainFileJson | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.version !== 1) return null;
  if (!Array.isArray(parsed.plugins) || !parsed.plugins.every(isChainPluginJson)) return null;
  return { version: 1, plugins: parsed.plugins };
}

export function serializeChainFile(chain: ChainFileJson): string {
  return JSON.stringify(chain, null, 2);
}

export interface CarveBand {
  freq: number;
  gainDb: number;
  q: number;
}

/** Appends one PeakFilter built-in per carve band to a chain (existing plugins
 *  preserved). A null/absent chain starts fresh. Pure — returns a new object. */
export function appendCarveBands(chain: ChainFileJson | null, bands: CarveBand[]): ChainFileJson {
  const base = chain?.plugins ?? [];
  const carved: ChainPluginJson[] = bands.map((b) => ({
    format: "builtin",
    path: "PeakFilter",
    pluginName: null,
    name: `Carve ${Math.round(b.freq)}Hz`,
    stateB64: btoa(JSON.stringify({ cutoff_frequency_hz: b.freq, gain_db: b.gainDb, q: b.q })),
  }));
  return { version: 1, plugins: [...base, ...carved] };
}

/** Project-relative asset path from a track `src`/preview URL: the part after
 *  `/preview/` (decoded, query stripped), or the src minus a leading `./` when
 *  it's already relative. Null only for empty input. */
export function projectRelativeAssetPath(url: string): string | null {
  if (!url) return null;
  const marker = "/preview/";
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    return decodeURIComponent(url.slice(idx + marker.length).split("?")[0] ?? "");
  }
  return url.replace(/^\.\//, "").split("?")[0] ?? null;
}
