// Carries the system fonts a project uses inside its zip, as the cloud has no copy of them.
import { bundleWithLocalizedFonts } from "../utils/bundleWithLocalizedFonts.js";
import { loadProducer } from "../utils/producer.js";
import { readStaged, type StagedFile } from "../utils/publishProject.js";

// Free look-alikes for system fonts the cloud lacks.
const LOOK_ALIKES: Record<string, string> = {
  "pingfang sc": "Noto Sans SC",
  "pingfang tc": "Noto Sans TC",
  "pingfang hk": "Noto Sans HK",
  "hiragino sans": "Noto Sans JP",
  "hiragino kaku gothic pro": "Noto Sans JP",
  "yu gothic": "Noto Sans JP",
  "apple sd gothic neo": "Noto Sans KR",
  "malgun gothic": "Noto Sans KR",
  "microsoft yahei": "Noto Sans SC",
  "microsoft jhenghei": "Noto Sans TC",
  "sf pro": "Inter",
  "sf pro display": "Inter",
  "sf pro text": "Inter",
  "helvetica neue": "Inter",
  helvetica: "Inter",
  arial: "Inter",
  "segoe ui": "Inter",
  georgia: "Lora",
  "times new roman": "Tinos",
  menlo: "JetBrains Mono",
  consolas: "JetBrains Mono",
};

function lookAlikeFor(family: string): string | undefined {
  return LOOK_ALIKES[family.trim().toLowerCase()];
}

type Injector = (html: string, options: object) => Promise<string>;

const QUIET = { warn() {}, info() {} };

async function injectorOr(inject?: Injector): Promise<Injector> {
  return (
    inject ??
    ((await loadProducer()) as { injectDeterministicFontFaces: Injector })
      .injectDeterministicFontFaces
  );
}

/** The families the resolver names in a fail-closed error, or null when it failed another way. */
function namedFamilies(err: unknown): string[] | null {
  const e = err as { code?: unknown; unresolvedFamilies?: unknown };
  if (e.code !== "FONT_FETCH_FAILED" || !Array.isArray(e.unresolvedFamilies)) return null;
  return e.unresolvedFamilies.filter((f): f is string => typeof f === "string");
}

/** The families the cloud cannot resolve; empty when all resolve or it cannot tell. */
async function unresolvedCloudFonts(
  dir: string,
  entryFile: string | undefined,
  run: Injector,
): Promise<string[]> {
  try {
    await bundleWithLocalizedFonts(
      dir,
      (html) =>
        run(html, { failClosedFontFetch: true, allowSystemFontCapture: false, logger: QUIET }),
      { entryFile },
    );
    return [];
  } catch (err) {
    // Only a named font counts; a network failure is the server's call.
    return namedFamilies(err) ?? [];
  }
}

/**
 * Adds the system fonts the project uses to its entry page as inline @font-face rules, so the zip carries them.
 * Returns the families whose font file is not on this machine; those cannot render in the cloud.
 */
export async function embedSystemFonts(
  opts: { dir: string; entryFile?: string; entryPath: string; fileMap: Map<string, StagedFile> },
  inject?: Injector,
): Promise<string[]> {
  const run = await injectorOr(inject);
  const wanted = await unresolvedCloudFonts(opts.dir, opts.entryFile, run);
  if (wanted.length === 0) return [];
  const css = wanted.map((f, i) => `.f${i}{font-family:"${f}"}`).join("");
  const probe = `<!doctype html><html><head><style>${css}</style></head><body></body></html>`;
  let out: string;
  try {
    out = await run(probe, {
      failClosedFontFetch: true,
      allowSystemFontCapture: true,
      systemFontsByInnerName: true,
      logger: QUIET,
    });
  } catch (err) {
    return namedFamilies(err) ?? wanted;
  }
  const faces = [...out.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1] ?? "")
    .filter((css) => css.includes("@font-face"))
    .join("\n");
  const entry = opts.fileMap.get(opts.entryPath);
  if (!faces || !entry) return wanted;
  const html = readStaged(entry).toString("utf-8");
  const tag = `<style data-hf-system-fonts>${faces}</style>`;
  const at = html.search(/<\/head>/i);
  opts.fileMap.set(
    opts.entryPath,
    Buffer.from(at < 0 ? tag + html : html.slice(0, at) + tag + html.slice(at), "utf-8"),
  );
  return [];
}

/** One line per font, with the swap when there is one. */
export function describeUnresolvedFonts(families: readonly string[]): string {
  return families
    .map((family) => {
      const swap = lookAlikeFor(family);
      return `HyperFrames couldn't find a font file for ${family} on this computer, so the cloud can't have it: ${
        swap ? `use ${swap}, ` : ""
      }switch to a font in your project or render on this computer.`;
    })
    .join("\n");
}
