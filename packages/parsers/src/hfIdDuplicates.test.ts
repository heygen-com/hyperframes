import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { ensureHfIds, mintHfId } from "./hfIds.js";

const identical = (n: number) =>
  `<main>${'<div class="c">x</div>'.repeat(n)}<p>a</p><p>a</p></main>`;

describe("minting ids for identical elements", () => {
  it("probes a bounded number of ids per element, not one per earlier twin", () => {
    const { document } = parseHTML(`<!DOCTYPE html><html><body>${identical(2000)}</body></html>`);
    let probes = 0;
    const assigned = new (class extends Set<string> {
      has(id: string) {
        probes++;
        return super.has(id);
      }
    })();
    for (const el of document.querySelectorAll("div.c")) mintHfId(el, assigned);

    expect(assigned.size).toBe(2000);
    expect(probes).toBeLessThan(2000 * 4);
  });

  it("keeps the ids it always minted (a wire contract with the served copy)", () => {
    const ids = [...ensureHfIds(identical(600)).matchAll(/data-hf-id="([^"]+)"/g)].map((m) => m[1]);

    expect(new Set(ids).size).toBe(603);
    // The sha1 of the ids joined by commas, from before duplicates resumed where their twin left off.
    expect(createHash("sha1").update(ids.join(",")).digest("hex")).toBe(
      "87e414b5dbc51e3547dc2f5d211ce334ef7f4c9c",
    );
  });
});
