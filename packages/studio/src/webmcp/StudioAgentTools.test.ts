// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { vi } from "vitest";
import { agentPreview } from "./agentPreview";
import { resizeSelectionFromAgent } from "./StudioAgentTools";

const readNowIn = (doc: Document, selection: DomEditSelection) =>
  agentPreview(() => ({ contentDocument: doc }) as HTMLIFrameElement, "index.html").readNow(
    selection,
  );

function rect(width: number, height: number): DOMRect {
  return { x: 10, y: 20, width, height } as DOMRect;
}

describe("agentPreview readNow on a live preview", () => {
  it("measures the replacement preview node after a commit reload", async () => {
    const oldElement = document.createElement("h1");
    oldElement.id = "headline";
    oldElement.getBoundingClientRect = () => rect(300, 50);
    const selection = {
      id: "headline",
      sourceFile: "index.html",
      element: oldElement,
    } as DomEditSelection;

    const liveDocument = document.implementation.createHTMLDocument();
    const replacement = liveDocument.createElement("h1");
    replacement.id = "headline";
    replacement.getBoundingClientRect = () => rect(280, 60);
    liveDocument.body.append(replacement);

    expect((await readNowIn(liveDocument, selection)).box).toEqual({
      x: 10,
      y: 20,
      width: 280,
      height: 60,
    });
  });

  it("does not hide a stale target behind its detached old node", async () => {
    const oldElement = document.createElement("h1");
    oldElement.id = "headline";
    const selection = {
      id: "headline",
      sourceFile: "index.html",
      element: oldElement,
    } as DomEditSelection;
    const liveDocument = document.implementation.createHTMLDocument();

    await expect(readNowIn(liveDocument, selection)).rejects.toThrow("target is missing");
  });
});

describe("resizeSelectionFromAgent", () => {
  it("applies the same live draft a pointer gesture shows before persistence", async () => {
    const element = document.createElement("div");
    element.style.width = "300px";
    element.style.height = "50px";
    const selection = { element } as DomEditSelection;
    const commit = vi.fn(async (_selection, _next, _offset, restore: () => void) => {
      expect(element.style.width).toBe("280px");
      expect(element.style.height).toBe("60px");
      restore();
    });

    await resizeSelectionFromAgent(selection, { width: 280, height: 60 }, commit);

    expect(commit).toHaveBeenCalledOnce();
    expect(element.style.width).toBe("300px");
    expect(element.style.height).toBe("50px");
  });
});
