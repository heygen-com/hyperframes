import type { LintContext, HyperframeLintFinding } from "../context";
import { readAttr } from "../utils";

export const adapterRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // missing_lottie_script
  ({ tags, scripts }) => {
    const allScriptTexts = scripts.filter((s) => !/\bsrc\s*=/.test(s.attrs)).map((s) => s.content);
    const allScriptSrcs = scripts
      .map((s) => readAttr(`<script ${s.attrs}>`, "src") || "")
      .filter(Boolean);

    const hasLottieAttr = tags.some((t) => readAttr(t.raw, "data-lottie-src") !== null);
    const usesLottieApi = allScriptTexts.some((t) =>
      /lottie\.(loadAnimation|setSpeed|play|stop|destroy)\b/.test(t),
    );
    const hasLottieScript = allScriptSrcs.some((src) => /lottie/i.test(src));

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
    const allScriptTexts = scripts.filter((s) => !/\bsrc\s*=/.test(s.attrs)).map((s) => s.content);
    const allScriptSrcs = scripts
      .map((s) => readAttr(`<script ${s.attrs}>`, "src") || "")
      .filter(Boolean);

    const usesThree = allScriptTexts.some((t) => /\bTHREE\./.test(t));
    const hasThreeScript = allScriptSrcs.some((src) => /three/i.test(src));

    if (!usesThree || hasThreeScript) return [];
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
