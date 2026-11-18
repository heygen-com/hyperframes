// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { readPreviewCompositionSize } from "./previewCompositionSize";

type Player = HTMLElement & {
  ready?: boolean;
  compositionWidth?: number;
  compositionHeight?: number;
};

/** A frame in a player's shadow root, as <hyperframes-player> holds it; a sealed one refuses its document. */
function frameInPlayer(sealed: boolean, player: Partial<Player>) {
  const host = Object.assign(document.createElement("div"), player) as Player;
  document.body.append(host);
  const iframe = document.createElement("iframe");
  host.attachShadow({ mode: "open" }).append(iframe);
  if (sealed) {
    const refusing = {
      get document(): Document {
        throw new DOMException("Blocked a frame with origin", "SecurityError");
      },
    };
    Object.defineProperty(iframe, "contentWindow", { get: () => refusing });
    Object.defineProperty(iframe, "contentDocument", { get: () => null });
  }
  return iframe;
}

afterEach(() => document.body.replaceChildren());

describe("readPreviewCompositionSize", () => {
  it("reads a sealed frame's size from its player once the player is ready", () => {
    const iframe = frameInPlayer(true, {
      ready: true,
      compositionWidth: 1080,
      compositionHeight: 1920,
    });
    expect(readPreviewCompositionSize(iframe)).toEqual({ width: 1080, height: 1920 });
  });

  it("reads no size from a sealed frame's player before it is ready, whose numbers are only defaults", () => {
    const iframe = frameInPlayer(true, {
      ready: false,
      compositionWidth: 1920,
      compositionHeight: 1080,
    });
    expect(readPreviewCompositionSize(iframe)).toBeNull();
  });

  it("reads a frame Studio can script from its document, not its player", () => {
    const iframe = frameInPlayer(false, {
      ready: true,
      compositionWidth: 1920,
      compositionHeight: 1080,
    });
    iframe.contentDocument!.body.innerHTML =
      '<div data-composition-id="main" data-width="720" data-height="1280"></div>';
    expect(readPreviewCompositionSize(iframe)).toEqual({ width: 720, height: 1280 });
  });
});
