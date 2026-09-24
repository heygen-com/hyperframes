import { describe, expect, it } from "vitest";
import { addScenePartsManifest } from "./scenePartsManifest";

const doc = (sceneA: string, root: string, signature = "1") => `<!doctype html><html><head>
<meta name="sig" content="${signature}"><style>.root{}</style><style data-hf-scene="a">${sceneA}</style>
</head><body><div data-composition-id="main">${root}
<div data-composition-id="a" data-hf-scene="a"><p>${sceneA}</p></div>
<div data-composition-id="b" data-hf-scene="b"><p>B</p></div></div>
<script data-hf-scene="a">/* ${sceneA} */</script></body></html>`;

const manifestOf = (html: string) => {
  const content = /<meta name="hf-scene-parts" content="([^"]*)"/.exec(html)?.[1] ?? "";
  return JSON.parse(content.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
};

describe("addScenePartsManifest", () => {
  it("changes only the edited scene's hash when only that scene changes", () => {
    const before = manifestOf(
      addScenePartsManifest(doc("one", "<h1>t</h1>"), ['meta[name="sig"]']),
    );
    const after = manifestOf(
      addScenePartsManifest(doc("two", "<h1>t</h1>", "2"), ['meta[name="sig"]']),
    );
    expect(Object.keys(before.scenes).sort()).toEqual(["a", "b"]);
    expect(after.shared).toBe(before.shared);
    expect(after.scenes.b).toBe(before.scenes.b);
    expect(after.scenes.a).not.toBe(before.scenes.a);
  });

  it("changes the shared hash for any change outside the scenes, including an unignored one", () => {
    const base = manifestOf(addScenePartsManifest(doc("one", "<h1>t</h1>"), ['meta[name="sig"]']));
    const root = manifestOf(addScenePartsManifest(doc("one", "<h1>u</h1>"), ['meta[name="sig"]']));
    const sig = manifestOf(addScenePartsManifest(doc("one", "<h1>t</h1>", "2")));
    expect(root.shared).not.toBe(base.shared);
    expect(root.scenes).toEqual(base.scenes);
    expect(sig.shared).not.toBe(manifestOf(addScenePartsManifest(doc("one", "<h1>t</h1>"))).shared);
  });

  it("leaves a document without scene parts untouched", () => {
    const html = "<!doctype html><html><head></head><body><p>x</p></body></html>";
    expect(addScenePartsManifest(html)).toBe(html);
  });

  it("changes the shared hash when scenes are reordered", () => {
    const page = (first: string, second: string) => `<html><head></head><body><div id="main">
<div data-hf-scene="${first}"><p>${first}</p></div><div data-hf-scene="${second}"><p>${second}</p></div>
</div></body></html>`;
    const ab = manifestOf(addScenePartsManifest(page("a", "b")));
    const ba = manifestOf(addScenePartsManifest(page("b", "a")));
    expect(ba.scenes).toEqual(ab.scenes);
    expect(ba.shared).not.toBe(ab.shared);
  });
});
