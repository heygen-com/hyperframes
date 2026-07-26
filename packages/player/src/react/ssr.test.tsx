// @vitest-environment node
//
// Server-rendering contract: the /react subpath must render via
// renderToString without evaluating the DOM-touching player module, without
// emitting React warnings (React 18's "useLayoutEffect does nothing on the
// server" class of issue), and without producing markup that would mismatch
// on hydration.
import { renderToString } from "react-dom/server";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const playerModuleEvaluations = vi.hoisted(() => ({ count: 0 }));
vi.mock("@hyperframes/player", () => {
  playerModuleEvaluations.count += 1;
  return {};
});

import { HyperframesPlayer, useIsomorphicLayoutEffect } from "./player.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HyperframesPlayer SSR", () => {
  it("substitutes useEffect for useLayoutEffect on the server", () => {
    // Structural guard for the React 18 SSR warning: on the server the
    // component must not reach useLayoutEffect at all.
    expect(useIsomorphicLayoutEffect).toBe(useEffect);
  });

  it("server-renders without warnings and without loading the player module", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = renderToString(
      <HyperframesPlayer
        src="./comp/index.html"
        controls
        playbackRate={1.5}
        className="hero"
        onReady={() => {}}
      />,
    );

    expect(html).toContain("<hyperframes-player");
    expect(html).toContain('class="hero"');
    // Attributes are applied client-side in effects, so the server markup must
    // stay bare — anything else would hydrate-mismatch against React's output.
    expect(html).not.toContain("playback-rate");
    expect(playerModuleEvaluations.count).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("with ssr, emits a declarative shadow DOM template around the composition iframe", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const html = renderToString(
      <HyperframesPlayer
        ssr
        src="./comp/index.html"
        poster="./poster.jpg"
        width={1280}
        height={720}
        className="hero"
      />,
    );

    expect(html).toContain('<template shadowrootmode="open">');
    expect(html).toContain('<iframe class="hfp-iframe"');
    expect(html).toContain('src="./comp/index.html"');
    expect(html).toContain('<img class="hfp-poster" src="./poster.jpg">');
    expect(html).toContain("<style data-hfp-ssr>");
    // String attributes ride on the host tag too, for crawlers and the
    // upgrade-time attribute replay.
    expect(html).toMatch(/<hyperframes-player[^>]* src=".\/comp\/index\.html"/);
    expect(html).toMatch(/<hyperframes-player[^>]* width="1280"/);
    expect(playerModuleEvaluations.count).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
