import { describe, it, expect } from "vitest";
import { ensureHfIds, mintHfId } from "./hfIds.js";
import { parseHTML } from "linkedom";

function ids(html: string): string[] {
  const { document } = parseHTML(html);
  return Array.from(document.querySelectorAll("[data-hf-id]")).map(
    (e) => e.getAttribute("data-hf-id") as string,
  );
}

describe("ensureHfIds", () => {
  it("mints a hf- id on every editable element node in body", () => {
    const html = `<!doctype html><html><body>
      <div class="card"><h1>Hi</h1><img src="a.png"><span>x</span></div>
    </body></html>`;
    const out = ensureHfIds(html);
    for (const id of ids(out)) expect(id).toMatch(/^hf-[a-z0-9]{4}$/);
    // div, h1, img, span = 4 ids
    expect(ids(out)).toHaveLength(4);
  });

  it("skips script/style/template/meta and head", () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"></head>
      <body><script>1</script><style>.a{}</style><p>keep</p></body></html>`;
    const out = ensureHfIds(html);
    // only the <p> gets an id
    expect(ids(out)).toHaveLength(1);
    expect(out).not.toContain("<script data-hf-id");
    expect(out).not.toContain("<style data-hf-id");
    expect(out).not.toContain("<meta data-hf-id");
  });

  it("is idempotent: a second call mints nothing and is byte-stable", () => {
    const html = `<!doctype html><html><body><div><p>a</p></div></body></html>`;
    const once = ensureHfIds(html);
    const twice = ensureHfIds(once);
    expect(twice).toBe(once);
  });

  it("pins existing data-hf-id and mints around it", () => {
    const html = `<!doctype html><html><body>
      <div data-hf-id="hf-keep"><p>a</p></div></body></html>`;
    const out = ensureHfIds(html);
    expect(out).toContain('data-hf-id="hf-keep"');
    expect(ids(out)).toContain("hf-keep");
    expect(ids(out)).toHaveLength(2); // div pinned + p minted
  });

  it("two identical sibling nodes get distinct ids", () => {
    const html = `<!doctype html><html><body>
      <p class="x">same</p><p class="x">same</p></body></html>`;
    const got = ids(ensureHfIds(html));
    expect(new Set(got).size).toBe(got.length);
  });

  it("is deterministic: same input → same ids", () => {
    const html = `<!doctype html><html><body><div><p>a</p><span>b</span></div></body></html>`;
    expect(ids(ensureHfIds(html))).toEqual(ids(ensureHfIds(html)));
  });

  it("mintHfId rehashes on collision against the assigned set", () => {
    const { document } = parseHTML(`<p class="x">same</p>`);
    const el = document.querySelector("p") as Element;
    const assigned = new Set<string>();
    const a = mintHfId(el, assigned);
    const b = mintHfId(el, assigned); // identical element, same assigned set
    expect(a).not.toBe(b);
    expect(a).toMatch(/^hf-[a-z0-9]{4}$/);
    expect(b).toMatch(/^hf-[a-z0-9]{4}$/);
  });
});
