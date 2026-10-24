import type { LintContext, HyperframeLintFinding } from "../context";
import { GLSL_SCRIPT_TYPES, shaderDomainOffsets } from "../shaderDomains";
import { readAttr } from "../utils";

export function shaderDomainWarning(): HyperframeLintFinding {
  return {
    code: "shader_unbounded_cosine_pow",
    severity: "warning",
    message:
      "Shader pow(1 - dot(...), ...) can receive a negative base when the cosine exceeds 1, including through GPU rounding. Undefined GLSL results can spread through glow or transmission textures as black artifacts.",
    fixHint:
      "Bound the cosine on both sides: pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), exponent). A lower-only max(dot(...), 0.0) does not bound the upper end. Inspect the affected frames on the target GPU.",
  };
}

export const shaderRules = [
  ({ scripts, locate }: LintContext): HyperframeLintFinding[] =>
    scripts.flatMap((script) => {
      const tag = `<script ${script.attrs}>`;
      if (readAttr(tag, "src") !== null) return [];
      const type = readAttr(tag, "type") ?? "";
      const glsl = GLSL_SCRIPT_TYPES.has(type.toLowerCase());
      if (type && !glsl && !/^(?:module|(?:text|application)\/javascript)$/i.test(type)) return [];
      return shaderDomainOffsets(script.content, glsl).map((offset) => ({
        ...shaderDomainWarning(),
        ...locate(script, offset),
      }));
    }),
];
