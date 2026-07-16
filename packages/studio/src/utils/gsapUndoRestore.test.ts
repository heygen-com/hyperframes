// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import { applyUndoRestoreToPreview, diffSoftReloadableRestore } from "./gsapUndoRestore";

// ── Bug 2: undo/redo restore soft-apply ──────────────────────────────────────

const wrap = (body: string) => `<html><body>${body}</body></html>`;

describe("diffSoftReloadableRestore", () => {
  it("reports the changed id for an attribute/inline-style-only diff", () => {
    const prev = wrap(`<div id="a" style="translate: 10px 10px">t</div>`);
    const next = wrap(`<div id="a" style="translate: 0px 0px">t</div>`);
    expect(diffSoftReloadableRestore(prev, next)).toEqual({ changedElementKeys: ["id:a"] });
  });

  it("identifies id-less elements by data-hf-id (selector-targeted clips)", () => {
    const prev = wrap(`<div class="sub" data-hf-id="hf-x1" style="z-index: 3">t</div>`);
    const next = wrap(`<div class="sub" data-hf-id="hf-x1" style="z-index: 8">t</div>`);
    expect(diffSoftReloadableRestore(prev, next)).toEqual({ changedElementKeys: ["hf:hf-x1"] });
  });

  it("fails closed when fallback ids are duplicated without unique data-hf-ids", () => {
    const prev = wrap(
      `<div id="dup" style="z-index: 8">first</div><div id="dup" style="z-index: 9">last</div>`,
    );
    const next = wrap(
      `<div id="dup" style="z-index: 3">first</div><div id="dup" style="z-index: 9">last</div>`,
    );
    expect(diffSoftReloadableRestore(prev, next)).toBeNull();
  });

  it("a child change inside an identified CONTAINER is soft (nested identities)", () => {
    // The composition root wraps every clip — the old innerHTML comparison at
    // the root re-detected the child's change and forced a full reload.
    const prev = wrap(
      `<div id="main" data-duration="42"><div class="sub" data-hf-id="hf-x1" data-start="39">t</div></div>`,
    );
    const next = wrap(
      `<div id="main" data-duration="39"><div class="sub" data-hf-id="hf-x1" data-start="26">t</div></div>`,
    );
    expect(diffSoftReloadableRestore(prev, next)).toEqual({
      changedElementKeys: ["id:main", "hf:hf-x1"],
    });
  });

  it("a changed data-hf-id itself is structural — NOT soft-reloadable", () => {
    const prev = wrap(`<div data-hf-id="hf-x1">t</div>`);
    const next = wrap(`<div data-hf-id="hf-x2">t</div>`);
    expect(diffSoftReloadableRestore(prev, next)).toBeNull();
  });

  it("treats a structural change (added element) as NOT soft-reloadable", () => {
    const prev = wrap(`<div id="a">t</div>`);
    const next = wrap(`<div id="a">t</div><div id="a-split">t</div>`);
    expect(diffSoftReloadableRestore(prev, next)).toBeNull();
  });

  it("treats an element text/child change as NOT soft-reloadable", () => {
    const prev = wrap(`<div id="a">one</div>`);
    const next = wrap(`<div id="a">two</div>`);
    expect(diffSoftReloadableRestore(prev, next)).toBeNull();
  });

  it("allows a GSAP-script-only change (no id'd-attribute diff)", () => {
    const prev = wrap(
      `<div id="a">t</div><script>window.__timelines["root"]=gsap.timeline().to("#a",{x:1});</script>`,
    );
    const next = wrap(
      `<div id="a">t</div><script>window.__timelines["root"]=gsap.timeline().to("#a",{x:9});</script>`,
    );
    expect(diffSoftReloadableRestore(prev, next)).toEqual({ changedElementKeys: [] });
  });
});

function buildLiveIframe(bodyHtml: string) {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = bodyHtml;
  const contentWindow = {
    gsap: { timeline: () => {} },
    __hfForceTimelineRebind: () => {},
    __timelines: {} as Record<string, unknown>,
    __player: { getTime: () => 3, seek: vi.fn() },
    __hfStudioManualEditsApply: vi.fn(),
  };
  return {
    iframe: { contentWindow, contentDocument: doc } as unknown as HTMLIFrameElement,
    contentWindow,
    doc,
  };
}

describe("applyUndoRestoreToPreview", () => {
  const ROOT = "index.html";

  it("soft-applies an attribute/style-only restore: syncs the live element, no full reload", () => {
    const { iframe, contentWindow, doc } = buildLiveIframe(
      `<div id="a" style="translate: 10px 10px" data-hf-path-offset="true">t</div>`,
    );
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(
          `<div id="a" style="translate: 10px 10px" data-hf-path-offset="true">t</div>`,
        ),
        restored: wrap(`<div id="a" style="translate: 0px 0px" data-hf-path-offset="true">t</div>`),
      },
    };
    const outcome = applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview);
    expect(outcome).toBe("soft");
    expect(reloadPreview).not.toHaveBeenCalled();
    // Live element reverted to the restored inline style.
    expect(doc.getElementById("a")!.getAttribute("style")).toBe("translate: 0px 0px");
    // No GSAP script in the restore → the manual-edit reapply runs, playhead held.
    expect(contentWindow.__player.seek).toHaveBeenCalledWith(3);
    expect(contentWindow.__hfStudioManualEditsApply).toHaveBeenCalled();
  });

  it("syncs a data-hf-id-identified live element (no DOM id) without reloading", () => {
    const { iframe, doc } = buildLiveIframe(
      `<div class="sub" data-hf-id="hf-x1" style="z-index: 8">t</div>`,
    );
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(`<div class="sub" data-hf-id="hf-x1" style="z-index: 8">t</div>`),
        restored: wrap(`<div class="sub" data-hf-id="hf-x1" style="z-index: 3">t</div>`),
      },
    };
    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("soft");
    expect(reloadPreview).not.toHaveBeenCalled();
    expect(doc.querySelector('[data-hf-id="hf-x1"]')!.getAttribute("style")).toBe("z-index: 3");
  });

  it.each([
    { label: "first", firstRestored: 3, lastRestored: 9 },
    { label: "last", firstRestored: 8, lastRestored: 3 },
  ])(
    "soft-restores the $label element when authored ids are duplicated",
    ({ firstRestored, lastRestored }) => {
      const markup = (firstZ: number, lastZ: number) =>
        `<div id="dup" data-hf-id="hf-first" style="z-index: ${firstZ}">first</div>` +
        `<div id="dup" data-hf-id="hf-last" style="z-index: ${lastZ}">last</div>`;
      const { iframe, doc } = buildLiveIframe(markup(8, 9));
      const reloadPreview = vi.fn();
      const files = {
        [ROOT]: {
          previous: wrap(markup(8, 9)),
          restored: wrap(markup(firstRestored, lastRestored)),
        },
      };

      expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("soft");
      expect(reloadPreview).not.toHaveBeenCalled();
      expect(doc.querySelector('[data-hf-id="hf-first"]')!.getAttribute("style")).toBe(
        `z-index: ${firstRestored}`,
      );
      expect(doc.querySelector('[data-hf-id="hf-last"]')!.getAttribute("style")).toBe(
        `z-index: ${lastRestored}`,
      );
    },
  );

  it("full-reloads without partially restoring when any changed live target is missing", () => {
    const { iframe, doc } = buildLiveIframe(`<div id="a" style="z-index: 8">a</div>`);
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(
          `<div id="a" style="z-index: 8">a</div><div id="b" style="z-index: 8">b</div>`,
        ),
        restored: wrap(
          `<div id="a" style="z-index: 3">a</div><div id="b" style="z-index: 3">b</div>`,
        ),
      },
    };

    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("full");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    // Target a resolved first, but the preflight found missing b before syncing either.
    expect(doc.getElementById("a")!.getAttribute("style")).toBe("z-index: 8");
  });

  it("does NOT re-run an UNCHANGED GSAP script for an attribute-only restore", () => {
    // The live doc holds a script element; a re-run would mutate/remove it
    // (applySoftReload removes stale script elements before re-running).
    const script = `window.__timelines["root"]=gsap.timeline().to("#a",{x:1});`;
    const { iframe, contentWindow, doc } = buildLiveIframe(
      `<div id="a" style="z-index: 8">t</div><script>${script}</script>`,
    );
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(`<div id="a" style="z-index: 8">t</div><script>${script}</script>`),
        restored: wrap(`<div id="a" style="z-index: 3">t</div><script>${script}</script>`),
      },
    };
    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("soft");
    expect(reloadPreview).not.toHaveBeenCalled();
    // The live script element is untouched — rebind-only finalization ran instead.
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(doc.querySelector("script")!.textContent).toBe(script);
    expect(contentWindow.__player.seek).toHaveBeenCalledWith(3);
    expect(contentWindow.__hfStudioManualEditsApply).toHaveBeenCalled();
    expect(doc.getElementById("a")!.getAttribute("style")).toBe("z-index: 3");
  });

  it("full-reloads a changed two-script restore without partially touching the live DOM", () => {
    const previousScripts = [
      `window.__timelines["root"]=gsap.timeline().to("#a",{x:1});`,
      `window.__timelines["captions"]=gsap.timeline().to("#a",{y:1});`,
    ];
    const restoredScripts = previousScripts.map((script) => script.replace(":1", ":9"));
    const scripts = (values: string[]) =>
      values.map((value) => `<script>${value}</script>`).join("");
    const { iframe, doc } = buildLiveIframe(
      `<div id="a" style="z-index: 8">t</div>${scripts(previousScripts)}`,
    );
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(`<div id="a" style="z-index: 8">t</div>${scripts(previousScripts)}`),
        restored: wrap(`<div id="a" style="z-index: 3">t</div>${scripts(restoredScripts)}`),
      },
    };

    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("full");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(doc.getElementById("a")!.getAttribute("style")).toBe("z-index: 8");
    expect([...doc.querySelectorAll("script")].map((script) => script.textContent)).toEqual(
      previousScripts,
    );
  });

  it("full-reloads a multi-file restore", () => {
    const { iframe } = buildLiveIframe(`<div id="a">t</div>`);
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(`<div id="a" style="x">t</div>`),
        restored: wrap(`<div id="a">t</div>`),
      },
      "scenes/intro.html": { previous: "a", restored: "b" },
    };
    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("full");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("full-reloads a structural restore (split/delete undo)", () => {
    const { iframe } = buildLiveIframe(`<div id="a">t</div><div id="a-split">t</div>`);
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(`<div id="a">t</div><div id="a-split">t</div>`),
        restored: wrap(`<div id="a">t</div>`),
      },
    };
    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("full");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("full-reloads when the restore touches a sub-comp, not the active comp", () => {
    const { iframe } = buildLiveIframe(`<div id="a">t</div>`);
    const reloadPreview = vi.fn();
    const files = { "scenes/intro.html": { previous: "a", restored: "b" } };
    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("full");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });
});
