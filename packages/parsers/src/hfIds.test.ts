import { describe, it, expect } from "vitest";
import { ensureHfIds, mintHfId } from "./hfIds.js";
import { parseHTML } from "linkedom";

function ids(html: string): string[] {
  const { document } = parseHTML(html);
  return Array.from(document.querySelectorAll("[data-hf-id]")).map(
    (e) => e.getAttribute("data-hf-id") as string,
  );
}

// data-hf-id of the first element matching `selector`.
function idOf(html: string, selector: string): string | null {
  const { document } = parseHTML(html);
  return document.querySelector(selector)?.getAttribute("data-hf-id") ?? null;
}

const doc = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

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

  // Post-persist stability: once data-hf-id is written back to source, edits
  // don't drift the id because the attribute is already present and pinned.
  it("pinned id survives text edit after first persist", () => {
    const raw = `<!doctype html><html><body><div>original text</div></body></html>`;
    const persisted = ensureHfIds(raw); // simulates write-back on first serve
    const [originalId] = ids(persisted);
    const edited = persisted.replace("original text", "edited text");
    expect(ids(ensureHfIds(edited))).toContain(originalId);
  });

  // Hash-based stability (no prior pin): the same element content yields the
  // same id regardless of what sibling elements appear in the document.
  it("content-keyed minting is stable: same element content → same id in different documents", () => {
    const alone = `<!doctype html><html><body><div class="card">hello</div></body></html>`;
    const [idAlone] = ids(ensureHfIds(alone));
    // The <div class="card">hello</div> appears alongside a new sibling here.
    const withSibling = `<!doctype html><html><body><span>prefix</span><div class="card">hello</div></body></html>`;
    expect(ids(ensureHfIds(withSibling))).toContain(idAlone);
  });
});

// Lock the edit-lifecycle behavior. These pin BOTH the guarantee that holds
// once ids are persisted to source (pinning) AND the behavior for truly unpinned
// HTML (no data-hf-id in the input — unreachable in production after write-back
// landed in R7 Task 1-2, but still the correct contract for that path).
describe("ensureHfIds — edit lifecycle (R1 stability)", () => {
  it("pinned id survives a content edit (the §3 write-back guarantee)", () => {
    // Element already carries data-hf-id in source (as it would after write-back).
    const edited = doc(`<p class="body" data-hf-id="hf-abcd">Hello world</p>`);
    expect(idOf(ensureHfIds(edited), "p.body")).toBe("hf-abcd");
  });

  it("unpinned id drifts when element text is edited (pure-hash, unreachable after write-back)", () => {
    // No data-hf-id in source → every parse re-mints from content. This path is
    // unreachable in production after R7 write-back: the first serve pins the id.
    const before = idOf(ensureHfIds(doc(`<p class="body">Hello</p>`)), "p.body");
    const after = idOf(ensureHfIds(doc(`<p class="body">Hello world</p>`)), "p.body");
    expect(before).not.toBe(after);
  });

  it("unpinned id drifts when attribute is edited (pure-hash, unreachable after write-back)", () => {
    const before = idOf(ensureHfIds(doc(`<p class="body">x</p>`)), "p");
    const after = idOf(ensureHfIds(doc(`<p class="lead">x</p>`)), "p");
    expect(before).not.toBe(after);
  });

  it("identical-content siblings: second occurrence gets a position-derived dedup id", () => {
    // Insertion stability holds for DISTINCT content (covered elsewhere), but a
    // second identical sibling collides and gets a position-derived dedup id.
    // First element keeps the base (content-derived) id; documented in project_hfid_dedup_tiebreak.
    const single = idOf(ensureHfIds(doc(`<p class="x">same</p>`)), "p.x");
    const pair = ids(ensureHfIds(doc(`<p class="x">same</p><p class="x">same</p>`)));
    expect(pair[0]).toBe(single); // first identical element: stable, content-derived
    expect(pair[1]).not.toBe(single); // second: dedup id, exists only by position
  });
});
