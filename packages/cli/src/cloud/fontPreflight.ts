// Stops a cloud render before upload when the compile step would refuse its fonts.
import { bundleToSingleHtml } from "@hyperframes/core/compiler";
import { loadProducer } from "../utils/producer.js";

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

export function lookAlikeFor(family: string): string | undefined {
  return LOOK_ALIKES[family.trim().toLowerCase()];
}

type Injector = (html: string, options: object) => Promise<string>;

/** The families the cloud cannot resolve; empty when all resolve or it cannot tell. */
export async function unresolvedCloudFonts(
  dir: string,
  entryFile?: string,
  inject?: Injector,
): Promise<string[]> {
  const run =
    inject ??
    ((await loadProducer()) as { injectDeterministicFontFaces: Injector })
      .injectDeterministicFontFaces;
  try {
    await run(await bundleToSingleHtml(dir, { entryFile }), {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
      logger: { warn() {}, info() {} },
    });
    return [];
  } catch (err) {
    // Only a named font blocks; a network failure is the server's call.
    const e = err as { code?: unknown; unresolvedFamilies?: unknown };
    if (e.code !== "FONT_FETCH_FAILED" || !Array.isArray(e.unresolvedFamilies)) return [];
    return e.unresolvedFamilies.filter((f): f is string => typeof f === "string");
  }
}

/** One line per font, with the swap when there is one. */
export function describeUnresolvedFonts(families: readonly string[]): string {
  return families
    .map((family) => {
      const swap = lookAlikeFor(family);
      return `${family} isn't available in the cloud: ${
        swap ? `use ${swap}, ` : ""
      }switch to a font in your project or render on this computer.`;
    })
    .join("\n");
}
