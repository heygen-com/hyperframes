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

const faceFamily = (face: string) =>
  /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;}"']+))/i
    .exec(face)
    ?.slice(1)
    .find(Boolean)
    ?.trim();

const placeholderFace = (family: string) =>
  `@font-face{font-family:"${family}";src:local("hyperframes-font-not-installed ${family}")}`;

/**
 * Adds the system fonts the project uses to its entry page as inline @font-face rules, so the zip carries them.
 * A family with no font file here gets an empty face (the local fallback) and is returned for the caller to name.
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
  const out = await run(probe, {
    failClosedFontFetch: false,
    allowSystemFontCapture: true,
    systemFontsByInnerName: true,
    logger: QUIET,
  });
  const captured = [...out.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1] ?? "")
    .filter((css) => css.includes("@font-face"))
    .join("\n");
  const found = new Set(
    [...captured.matchAll(/@font-face\s*{[^}]*}/gi)]
      .map((m) => faceFamily(m[0])?.toLowerCase())
      .filter((f): f is string => f !== undefined),
  );
  const missing = wanted.filter((family) => !found.has(family.toLowerCase()));
  const faces = [captured, ...missing.map(placeholderFace)].filter(Boolean).join("\n");
  const entry = opts.fileMap.get(opts.entryPath);
  if (!entry) return missing;
  const html = readStaged(entry).toString("utf-8");
  const tag = `<style data-hf-system-fonts>${faces}</style>`;
  const at = html.search(/<\/head>/i);
  opts.fileMap.set(
    opts.entryPath,
    Buffer.from(at < 0 ? tag + html : html.slice(0, at) + tag + html.slice(at), "utf-8"),
  );
  return missing;
}

/** One line per font that is not on this computer: the cloud renders it with the same fallback a local render uses. */
export function describeSwappedFonts(families: readonly string[]): string {
  return families
    .map((family) => {
      const swap = lookAlikeFor(family);
      return `${family} is not on this computer, so it renders in the next font of its stack (or the default font), as a local render does${
        swap ? `; ${swap} is a free look-alike you can use instead` : ""
      }.`;
    })
    .join("\n");
}
