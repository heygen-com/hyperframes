import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import { registerWebglCanvases } from "../utils/webglCanvasRegistry.js";

interface AuditIssue {
  code: string;
  severity: string;
  selector: string;
}

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const script = readFileSync(new URL("./layout-audit.browser.js", import.meta.url), "utf8");

// A cyan triangle drawn additively: colour is added while blendSrcAlpha Zero keeps alpha at 0.
function glowPage(attributes: string, srcAlpha: "ZERO" | "ONE"): string {
  return `<!doctype html><body style="margin:0;background:#202020">
    <div data-composition-id="main" data-width="320" data-height="180"
      style="position:relative;width:320px;height:180px">
      <canvas id="glow" width="320" height="180" style="position:absolute;inset:0"></canvas>
    </div>
    <script>
      const gl = document.getElementById("glow").getContext("webgl", ${attributes});
      const shader = (type, source) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        return s;
      };
      const program = gl.createProgram();
      const vertex = "attribute vec2 p; void main() { gl_Position = vec4(p, 0, 1); }";
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "void main() { gl_FragColor = vec4(0.4, 0.87, 1.0, 1.0); }"));
      gl.linkProgram(program);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.8, -0.8, 0.8, -0.8, 0, 0.8]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.${srcAlpha}, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    </script></body>`;
}

describe.runIf(executablePath)("webgl_colour_at_zero_alpha in Chromium", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function audit(html: string): Promise<AuditIssue[]> {
    const tab = await browser.newPage();
    try {
      await tab.evaluateOnNewDocument(registerWebglCanvases);
      await tab.goto(`data:text/html,${encodeURIComponent(html)}`);
      // A later task than the draw, as in check: the frame has been presented by now.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tab.addScriptTag({ content: script });
      const issues = await tab.evaluate(() =>
        Reflect.get(window, "__hyperframesLayoutAudit")({ time: 1, tolerance: 2 }),
      );
      return issues as AuditIssue[];
    } finally {
      await tab.close();
    }
  }

  const glowFinding = (issues: AuditIssue[]) =>
    issues.find((issue) => issue.code === "webgl_colour_at_zero_alpha");

  it("warns on an additive glow that leaves colour at alpha 0", async () => {
    const issues = await audit(glowPage("{ alpha: true, premultipliedAlpha: true }", "ZERO"));
    expect(glowFinding(issues)).toMatchObject({ severity: "warning", selector: "#glow" });
  });

  it.each([
    ["an opaque canvas", "{ alpha: false }", "ZERO"],
    ["a canvas that is not premultiplied", "{ alpha: true, premultipliedAlpha: false }", "ZERO"],
    [
      "a glow that writes alpha with its colour",
      "{ alpha: true, premultipliedAlpha: true }",
      "ONE",
    ],
  ] as const)("stays quiet for %s", async (_name, attributes, srcAlpha) => {
    expect(glowFinding(await audit(glowPage(attributes, srcAlpha)))).toBeUndefined();
  });
});
