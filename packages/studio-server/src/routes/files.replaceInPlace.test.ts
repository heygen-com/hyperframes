// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { registerFileRoutes } from "./files";
import { stubAdapter } from "./stubAdapter.test-helpers";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Anim {
  id: string;
  targetSelector: string;
  resolvedStart?: number;
  method: string;
}

const notHold = (a: Anim) => a.method !== "set";

function app(script: string): Hono {
  const dir = mkdtempSync(join(tmpdir(), "hf-replace-in-place-"));
  dirs.push(dir);
  const html = `<!DOCTYPE html><html><body data-duration="10">
<div id="a"></div><div id="b"></div><div id="c"></div>
<script data-hyperframes-gsap>
const tl = gsap.timeline({ paused: true });
${script}
window.__timelines = { main: tl };
</script>
</body></html>`;
  writeFileSync(join(dir, "comp.html"), html);
  const hono = new Hono();
  registerFileRoutes(hono, stubAdapter(dir));
  return hono;
}

async function animations(hono: Hono): Promise<Anim[]> {
  const res = await hono.request("http://localhost/projects/demo/gsap-animations/comp.html");
  return ((await res.json()) as { animations: Anim[] }).animations;
}

// The script's calls, without the hold sets the server keeps before a first position keyframe.
const calls = (code: string) =>
  code.split("\n").filter((line) => line.startsWith("tl.") && !line.includes("hf-hold"));

/** A move on `selector` at the playhead, sent the way the playhead writer sends it. */
async function moveAtPlayhead(script: string, selector: string) {
  const hono = app(script);
  const before = await animations(hono);
  const edited = before.find((a) => a.targetSelector === selector)!;
  const res = await hono.request("http://localhost/projects/demo/gsap-mutations/comp.html", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "replace-with-keyframes",
      animationId: edited.id,
      targetSelector: selector,
      position: edited.resolvedStart,
      duration: 1,
      keyframes: [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 50, properties: { x: 40 } },
        { percentage: 100, properties: { x: 100 } },
      ],
      easeEach: "none",
    }),
  });
  const { after: html } = (await res.json()) as { after: string };
  const after = await animations(hono);
  const starts = (list: Anim[]) => list.map((a) => [a.targetSelector, a.resolvedStart]);
  return { html, starts: starts(after.filter(notHold)), was: starts(before) };
}

describe("an edit at the playhead rewrites its tween where it stands", () => {
  it.each([
    [
      "no position argument",
      `tl.to("#a", { x: 100, duration: 1 });\ntl.to("#b", { y: 50, duration: 1 });`,
    ],
    [
      "'<' and '+='",
      `tl.to("#a", { x: 100, duration: 1 }, 1);\ntl.to("#b", { y: 50, duration: 1 }, "<");\ntl.to("#c", { y: 9, duration: 1 }, "+=0.5");`,
    ],
    [
      "'>'",
      `tl.to("#a", { x: 100, duration: 1 }, 0.5);\ntl.to("#b", { y: 50, duration: 1 }, ">");`,
    ],
    [
      "a label",
      `tl.addLabel("intro", 2);\ntl.to("#a", { x: 100, duration: 1 }, "intro");\ntl.to("#b", { y: 50, duration: 1 }, "intro+=0.5");`,
    ],
    [
      "a from() entrance",
      `tl.from("#a", { x: -60, duration: 1 });\ntl.to("#b", { y: 50, duration: 1 });`,
    ],
  ])("leaves every other tween's source and start alone after %s", async (_, script) => {
    const { html, starts, was } = await moveAtPlayhead(script, "#a");

    expect(starts).toEqual(was);
    const others = calls(script).filter((line) => !line.includes('"#a"'));
    expect(calls(html).filter((line) => !line.includes('"#a"'))).toEqual(others);
    expect(calls(html).findIndex((line) => line.includes('"#a"'))).toBe(
      calls(script).findIndex((line) => line.includes('"#a"')),
    );
  });

  it("keeps a chained call's next link in place", async () => {
    const script = `tl.to("#a", { x: 100, duration: 1 }).to("#b", { y: 50, duration: 1 });`;
    const { html, starts, was } = await moveAtPlayhead(script, "#a");

    expect(starts).toEqual(was);
    expect(calls(html)).toHaveLength(1);
    expect(calls(html)[0]).toMatch(
      /^tl\.to\("#a", \{ keyframes: .*\}\)\.to\("#b", \{ y: 50, duration: 1 \}\);$/,
    );
  });

  it.each([
    [
      "a relative one",
      `tl.to("#b", { y: 50, duration: 1 }, 0);\ntl.to("#a", { x: 100, duration: 1 }, "<");`,
      `"<");`,
    ],
    [
      "a label",
      `tl.addLabel("intro", 2);\ntl.to("#a", { x: 100, duration: 1 }, "intro");`,
      `"intro");`,
    ],
    [
      "the last tween's number",
      `tl.to("#b", { y: 50, duration: 1 }, 0);\ntl.to("#a", { x: 100, duration: 1 }, 1);`,
      `}, 1);`,
    ],
  ])("keeps the edited tween's own position argument when it is %s", async (_, script, tail) => {
    const { html, starts, was } = await moveAtPlayhead(script, "#a");

    expect(starts).toEqual(was);
    const edited = calls(html).find((line) => line.includes('"#a"'))!;
    expect(edited.endsWith(tail)).toBe(true);
    expect(calls(html).indexOf(edited)).toBe(calls(script).findIndex((l) => l.includes('"#a"')));
  });
});
