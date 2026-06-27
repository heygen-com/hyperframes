import type { LintContext, HyperframeLintFinding } from "../context";
import { readAttr, extractScriptTextsAndSrcs } from "../utils";

export const adapterRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // missing_lottie_script
  ({ tags, scripts }) => {
    const { texts, srcs } = extractScriptTextsAndSrcs(scripts);

    const hasLottieAttr = tags.some((t) => readAttr(t.raw, "data-lottie-src") !== null);
    const usesLottieApi = texts.some((t) =>
      /lottie\.(loadAnimation|setSpeed|play|stop|destroy)\b/.test(t),
    );
    const hasLottieScript = srcs.some((src) => /lottie/i.test(src));

    if (!(hasLottieAttr || usesLottieApi) || hasLottieScript) return [];
    return [
      {
        code: "missing_lottie_script",
        severity: "error",
        message:
          "Composition uses Lottie but no Lottie script is loaded. The animation will not render.",
        fixHint:
          'Add <script src="https://cdn.jsdelivr.net/npm/lottie-web@5/build/player/lottie.min.js"></script> before your Lottie code.',
      },
    ];
  },

  // missing_three_script
  ({ scripts }) => {
    const { texts, srcs } = extractScriptTextsAndSrcs(scripts);

    const usesThree = texts.some((t) => /\bTHREE\./.test(t));
    const hasThreeScript = srcs.some((src) => /three/i.test(src));
    const hasThreeImportMap = texts.some(
      (t) =>
        /["']three["']/.test(t) &&
        /importmap/.test(scripts.find((s) => s.content === t)?.attrs || ""),
    );
    const hasThreeModuleImport = texts.some(
      (t) => /\bimport\b.*['"]three['"]/.test(t) || /\bfrom\s+['"]three['"]/.test(t),
    );

    if (!usesThree || hasThreeScript || hasThreeImportMap || hasThreeModuleImport) return [];
    return [
      {
        code: "missing_three_script",
        severity: "error",
        message:
          "Composition uses Three.js but no Three.js script is loaded. The 3D scene will not render.",
        fixHint:
          'Add <script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script> before your Three.js code.',
      },
    ];
  },
];
