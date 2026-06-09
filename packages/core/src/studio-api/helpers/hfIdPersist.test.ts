import { describe, it, expect } from "vitest";
import { normalizeHfIds } from "./hfIdPersist.js";

describe("normalizeHfIds", () => {
  it("marks changed=true and adds data-hf-id to all body elements when untagged", () => {
    const raw = `<!doctype html><html><body><div><p>hello</p></div></body></html>`;
    const { html, changed } = normalizeHfIds(raw);
    expect(changed).toBe(true);
    expect(html).toContain('data-hf-id="hf-');
    // div and p both tagged
    const matches = html.match(/data-hf-id="hf-[a-z0-9]{4}"/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });

  it("marks changed=false for already-normalized HTML (idempotent round-trip)", () => {
    const raw = `<!doctype html><html><body><div><p>hello</p></div></body></html>`;
    const first = normalizeHfIds(raw).html;
    const { html, changed } = normalizeHfIds(first);
    expect(changed).toBe(false);
    expect(html).toBe(first);
  });
});
