// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { applyAnimeSoftReload, extractAnimeScriptText } from "./animeSoftReload";

const SCRIPT_TEXT = `
const tl = anime.createTimeline({ autoplay: false });
tl.add("#box", { x: 120, duration: 1000 }, 0);
hyperframesAnime.register("main", tl);
`;

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  throw new Error("Expected record");
}

function buildAnimeIframe(scriptText = SCRIPT_TEXT): {
  iframe: HTMLIFrameElement;
  oldRevert: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
  restoreAppendChild: () => void;
} {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", { value: window });
  Object.defineProperty(iframe, "contentDocument", { value: document });

  const script = document.createElement("script");
  script.textContent = scriptText;
  document.body.appendChild(script);

  const oldRevert = vi.fn();
  const unregister = vi.fn((id: string) => {
    Reflect.deleteProperty(recordValue(Reflect.get(window, "__hfAnime")), id);
  });
  const seek = vi.fn();
  Reflect.set(window, "__hfAnime", {
    main: { id: "main", instance: { revert: oldRevert, seek: vi.fn() } },
  });
  Reflect.set(window, "hyperframesAnime", {
    unregister,
    register(id: string, instance: unknown) {
      Reflect.set(recordValue(Reflect.get(window, "__hfAnime")), id, { id, instance });
      return { id, instance };
    },
  });
  Reflect.set(window, "anime", {
    createTimeline: () => ({
      add: () => undefined,
      seek: vi.fn(),
      pause: vi.fn(),
    }),
  });
  Reflect.set(window, "__player", { getTime: () => 1.25, seek });

  const realAppend = document.body.appendChild.bind(document.body);
  const originalAppendChild = document.body.appendChild;
  document.body.appendChild = function appendChild<T extends Node>(node: T): T {
    const result = realAppend(node);
    if (node instanceof HTMLScriptElement && node.textContent?.includes("hyperframesAnime")) {
      const api = recordValue(Reflect.get(window, "hyperframesAnime"));
      const register = api.register;
      if (typeof register === "function") {
        register("main", { seek: vi.fn(), pause: vi.fn() });
      }
    }
    return result;
  };

  return {
    iframe,
    oldRevert,
    unregister,
    seek,
    restoreAppendChild: () => {
      document.body.appendChild = originalAppendChild;
    },
  };
}

describe("extractAnimeScriptText", () => {
  it("extracts a single anime script from serialized HTML", () => {
    const html = `<!doctype html><html><body><script>${SCRIPT_TEXT}</script></body></html>`;

    expect(extractAnimeScriptText(html)).toContain('hyperframesAnime.register("main", tl)');
  });

  it("returns null when multiple anime scripts are present", () => {
    const html = `<!doctype html><html><body>
      <script>${SCRIPT_TEXT}</script>
      <script>${SCRIPT_TEXT.replace("main", "secondary")}</script>
    </body></html>`;

    expect(extractAnimeScriptText(html)).toBeNull();
  });
});

describe("applyAnimeSoftReload", () => {
  it("replaces the matching anime script and preserves the current preview frame", () => {
    const { iframe, oldRevert, unregister, seek, restoreAppendChild } = buildAnimeIframe();
    try {
      const result = applyAnimeSoftReload(
        iframe,
        SCRIPT_TEXT.replace("x: 120", "x: 240"),
        undefined,
        2.5,
      );

      expect(result).toBe("applied");
      expect(oldRevert).toHaveBeenCalled();
      expect(unregister).toHaveBeenCalledWith("main");
      expect(seek).toHaveBeenCalledWith(2.5);
      expect(document.querySelectorAll("script:not([src])")).toHaveLength(1);
      expect(document.body.textContent).toContain("x: 240");
    } finally {
      restoreAppendChild();
    }
  });
});
