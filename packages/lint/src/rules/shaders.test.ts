import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

const unsafe = "pow(1.0-max(dot(vN,vV),0.0),1.6)";
const shader = (expression: string) => `varying vec3 vN, vV;
void main(){
  float f=${expression};
  gl_FragColor=vec4(vec3(f),1.0);
}`;

async function findings(script: string) {
  const result = await lintHyperframeHtml(`<script>${script}</script>`, { filePath: "index.html" });
  return result.findings.filter((finding) => finding.code === "shader_unbounded_cosine_pow");
}

describe("shader numeric domains", () => {
  it("warns at the authored Crescendo orb expression inside a static shader", async () => {
    const result = await findings(`const fragmentShader = \`${shader(unsafe)}\`;`);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ severity: "warning", file: "index.html", line: 3 });
    expect(result[0]?.fixHint).toContain("clamp");
  });

  it("accepts the one-line clamp that fixes the affected Mac", async () => {
    expect(
      await findings(
        `const fragmentShader = \`${shader("pow(1.0-clamp(dot(vN,vV),0.0,1.0),1.6)")}\`;`,
      ),
    ).toEqual([]);
  });

  it.each([
    "pow(1.-dot(normalize(vN), normalize(vV)), 1.6)",
    "pow((1.0 - max(0.0, dot(vN, vV))), 2.0)",
    "pow(1.0 - dot(vN, vV), exponent)",
  ])("warns for an unbounded cosine: %s", async (expression) => {
    expect(await findings(`const fragmentShader = \`${shader(expression)}\`;`)).toHaveLength(1);
  });

  it.each([
    "pow(max(1.0-dot(vN,vV),0.0),1.6)",
    "pow(clamp(1.0-dot(vN,vV),0.0,1.0),1.6)",
    "pow(max(dot(vN,vV),0.0),2.0)",
    "pow(1.0-clamp(dot(vN,vV),0.0,1.0),2.0)",
  ])("accepts a bounded base: %s", async (expression) => {
    expect(await findings(`const fragmentShader = \`${shader(expression)}\`;`)).toEqual([]);
  });

  it("ignores JavaScript comments, ordinary maths, and shader comments", async () => {
    expect(
      await findings(`// const fragmentShader = \`${shader(unsafe)}\`;
      const f = Math.pow(1-Math.max(dot(vN,vV),0),1.6);
      const fragmentShader = \`${shader("1.0 /* " + unsafe + " */")}\`;`),
    ).toEqual([]);
  });

  it("reports both authored locations rather than collapsing identical warnings", async () => {
    const result = await findings(`const a=\`${shader(unsafe)}\`;
      const b=\`${shader(unsafe)}\`;`);
    expect(result.map((finding) => finding.line)).toEqual([3, 8]);
  });

  it.each(["x-shader/x-fragment", "x-shader/x-vertex", "text/glsl"])(
    "accepts %s shader source without parsing it as JavaScript",
    async (type) => {
      const result = await lintHyperframeHtml(`<!doctype html><html><body>
        <div id="root" data-composition-id="shader-demo" data-width="1920" data-height="1080"
          data-duration="1" data-no-timeline></div>
        <script type="${type}">precision mediump float; void main() {}</script>
        <script>window.__timelines = {};</script>
      </body></html>`);
      expect(result.findings).toEqual([]);
    },
  );

  it("checks numeric domains in native GLSL without JavaScript syntax errors", async () => {
    const result = await lintHyperframeHtml(
      `<script type="x-shader/x-fragment">${shader(unsafe)}</script>`,
    );
    expect(
      result.findings.filter((finding) => finding.code === "shader_unbounded_cosine_pow"),
    ).toHaveLength(1);
    expect(result.findings.map((finding) => finding.code)).not.toContain(
      "invalid_inline_script_syntax",
    );
  });

  it("checks escaped static strings without claiming unmapped source coordinates", async () => {
    const result = await findings(`const fragmentShader=${JSON.stringify(shader(unsafe))};`);
    expect(result).toMatchObject([{ file: "index.html" }]);
    expect(result[0]?.line).toBeUndefined();
  });

  it("does not claim exact offsets after template CRLF normalization", async () => {
    const result = await findings(
      `const fragmentShader = \`${shader(unsafe).replaceAll("\n", "\r\n")}\`;`,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.line).toBeUndefined();
    expect(result[0]?.column).toBeUndefined();
  });

  it("leaves dynamic shader assembly and malformed JavaScript to other checks", async () => {
    expect(await findings("const shader = `void main(){${expression}}`;")).toEqual([]);
    expect(await findings("const shader = `")).toEqual([]);
  });
});
