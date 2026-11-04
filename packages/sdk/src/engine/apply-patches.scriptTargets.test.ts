import { describe, expect, it } from "vitest";
import { parseMutable } from "./model.js";
import { applyOverrideSet, applyPatchesToDocument } from "./apply-patches.js";
import { serializeDocument } from "./serialize.js";
import { openComposition } from "../session.js";

// The failing shape: the script dereferences the lookup unguarded, so a removed node throws.
const HTML = `<!DOCTYPE html><html><body>
<div data-composition-id="c" data-width="1920" data-height="1080">
<svg><path data-hf-id="hf-arch" id="arch-path" d="M0 0"></path></svg>
<audio data-hf-id="hf-aud" id="narration" src="a.mp3" data-start="0" data-duration="9"></audio>
<div data-hf-id="hf-plain" id="plain">keep</div>
</div>
<script>document.getElementById('arch-path').getTotalLength(); document.getElementById('narration');</script>
</body></html>`;

describe("a stored delete a script looks up", () => {
  it("leaves the live document, and serializes back hidden", () => {
    const parsed = parseMutable(HTML);
    applyOverrideSet(parsed, { "hf-arch": null });
    expect(parsed.document.getElementById("arch-path")).toBeNull();
    const out = serializeDocument(parsed);
    expect(out).toContain('id="arch-path"');
    expect(out).toContain("display: none");
    expect(parsed.document.getElementById("arch-path")).toBeNull();
  });

  it("is no longer a clip once serialized, so its media is not mixed", () => {
    const parsed = parseMutable(HTML);
    applyOverrideSet(parsed, { "hf-aud": null });
    const out = serializeDocument(parsed);
    expect(out).toContain('id="narration"');
    expect(out).not.toMatch(/id="narration"[^>]*data-start|data-start[^>]*id="narration"/);
    expect(out).not.toContain('data-duration="9"');
    // The audio mixer and the runtime skip [data-hidden]; display:none alone would still play the track.
    expect(out).toMatch(/<audio[^>]*data-hidden/);
  });

  it("is still absent from the session model", async () => {
    const comp = await openComposition(HTML, { overrides: { "hf-arch": null }, history: false });
    expect(comp.getElements().some((el) => el.id === "hf-arch")).toBe(false);
    expect(comp.getElement("hf-arch")).toBeNull();
    expect(comp.serialize()).toContain('id="arch-path"');
  });

  it("is not written back twice once an undo has put it back", () => {
    const parsed = parseMutable(HTML);
    applyOverrideSet(parsed, { "hf-arch": null });
    const [kept] = parsed.keptDeletes ?? [];
    applyPatchesToDocument(parsed, [
      {
        op: "add",
        path: "/elements/hf-arch",
        value: { html: kept?.html, parentId: kept?.parentId, siblingIndex: kept?.siblingIndex },
      },
    ]);
    expect(serializeDocument(parsed).match(/id="arch-path"/g)).toHaveLength(1);
  });

  it("is removed as before when no script looks it up", () => {
    const parsed = parseMutable(HTML);
    applyOverrideSet(parsed, { "hf-plain": null });
    expect(serializeDocument(parsed)).not.toContain('id="plain"');
  });

  it("is removed by a plain patch, which undo and redo rely on", () => {
    const parsed = parseMutable(HTML);
    applyPatchesToDocument(parsed, [{ op: "remove", path: "/elements/hf-arch" }]);
    expect(serializeDocument(parsed)).not.toContain('id="arch-path"');
  });
});

const MEDIA_HTML = `<!DOCTYPE html><html><body>
<div data-composition-id="c" data-width="1920" data-height="1080">
<video data-hf-id="hf-vid" id="clip" src="https://cdn.test/clip.mp4" poster="https://cdn.test/p.png" data-start="0" data-duration="5"></video>
<picture data-hf-id="hf-pic" id="pic"><source srcset="https://cdn.test/a.webp"><img src="https://cdn.test/a.png" srcset="https://cdn.test/a2.png 2x"></picture>
<div data-hf-id="hf-bg" id="bg" style="background-image: url(https://cdn.test/bg.png); color: red"></div>
<div data-hf-id="hf-keep" id="keep" style="background-image: url(https://cdn.test/live.png)"></div>
</div>
<script>document.getElementById('clip').getBoundingClientRect(); document.getElementById('pic').getBoundingClientRect(); document.getElementById('bg').getBoundingClientRect();</script>
</body></html>`;

describe("a kept delete carries no media source", () => {
  const out = () => {
    const parsed = parseMutable(MEDIA_HTML);
    applyOverrideSet(parsed, { "hf-vid": null, "hf-pic": null, "hf-bg": null });
    return serializeDocument(parsed);
  };

  it("keeps the nodes a script looks up but drops what the renderer would fetch", () => {
    const html = out();
    for (const id of ["clip", "pic", "bg"]) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain("clip.mp4");
    expect(html).not.toContain("p.png");
    expect(html).not.toContain("a.webp");
    expect(html).not.toContain("a.png");
    expect(html).not.toContain("a2.png");
    expect(html).not.toContain("bg.png");
    expect(html).toContain("color: red");
  });

  it("leaves the sources of nodes that were not deleted", () => {
    expect(out()).toContain("live.png");
  });
});

const lookupDoc = (script: string) => `<!DOCTYPE html><html><body>
<div data-composition-id="c" data-width="1920" data-height="1080">
<svg data-hf-id="hf-halftone" class="halftone-svg"><path d="M0 0"></path></svg>
<div data-hf-id="hf-fiber" id="fiber-1"></div>
<div data-hf-id="hf-plain" id="plain">keep</div>
</div>
<script>${script}</script>
</body></html>`;

describe("a stored delete any script lookup could reach", () => {
  const kept = (script: string, id: string) => {
    const parsed = parseMutable(lookupDoc(script));
    applyOverrideSet(parsed, { [id]: null });
    return serializeDocument(parsed).includes("data-hidden");
  };

  it("is hidden when the script looks it up by class", () => {
    expect(kept("document.querySelector('.halftone-svg').getBBox();", "hf-halftone")).toBe(true);
    expect(
      kept("document.getElementsByClassName('halftone-svg')[0].getBBox();", "hf-halftone"),
    ).toBe(true);
  });

  it("is hidden when the lookup argument is a variable", () => {
    expect(
      kept(
        "['#fiber-1'].forEach(function (s) { document.querySelector(s).getTotalLength(); });",
        "hf-fiber",
      ),
    ).toBe(true);
    expect(
      kept("var id = 'fiber-1'; document.getElementById(id).getTotalLength();", "hf-fiber"),
    ).toBe(true);
  });

  it("is hidden when the argument is a literal continued by an expression", () => {
    const loop = (call: string) => `for (var n = 1; n < 4; n++) ${call}.getTotalLength();`;
    expect(kept(loop("document.getElementById('fiber-' + n)"), "hf-fiber")).toBe(true);
    expect(kept(loop("document.querySelector('#fiber-' + n)"), "hf-fiber")).toBe(true);
    expect(kept(loop("document.getElementById('fiber-'.concat(n))"), "hf-fiber")).toBe(true);
  });

  it("is hidden when a class or tag lookup carries a template placeholder", () => {
    const call = (lookup: string) => `${lookup}[0].getBBox();`;
    expect(kept(call("document.getElementsByClassName(`item-${n}`)"), "hf-halftone")).toBe(true);
    expect(kept(call("document.getElementsByTagName(`${t}`)"), "hf-halftone")).toBe(true);
  });

  it("is still removed when no lookup can reach it", () => {
    expect(kept("document.getElementById('other').getBBox();", "hf-plain")).toBe(false);
  });
});
