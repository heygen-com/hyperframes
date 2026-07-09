import { describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  tryAnimeDragIntercept,
  tryAnimeResizeIntercept,
  tryAnimeRotationIntercept,
} from "./animeRuntimeBridge";

const selection = { id: "box", selector: "#box" } as DomEditSelection;

function animeAnimation(overrides: Partial<GsapAnimation>): GsapAnimation {
  return {
    id: "anime-1",
    targetSelector: "#box",
    method: "to",
    position: 0,
    duration: 1,
    properties: {},
    engine: "animejs",
    anime: { engine: "animejs" },
    ...overrides,
  } as GsapAnimation;
}

describe("anime runtime/source bridge", () => {
  it("commits translateX/Y through the anime mutation boundary on drag", async () => {
    const commit = vi.fn(async () => {});

    const handled = await tryAnimeDragIntercept(
      selection,
      { x: 24, y: -8 },
      [animeAnimation({ propertyGroup: "position", properties: { translateX: 0 } })],
      commit,
    );

    expect(handled).toBe(true);
    expect(commit).toHaveBeenCalledWith(
      selection,
      {
        type: "update-properties",
        animationId: "anime-1",
        properties: { translateX: 24, translateY: -8 },
      },
      expect.objectContaining({ label: "Move anime.js layer", softReload: true }),
    );
  });

  it("commits width/height through the anime mutation boundary on resize", async () => {
    const commit = vi.fn(async () => {});

    const handled = await tryAnimeResizeIntercept(
      selection,
      { width: 101.4, height: 44.6 },
      [animeAnimation({ propertyGroup: "size", properties: { width: 10 } })],
      commit,
    );

    expect(handled).toBe(true);
    expect(commit.mock.calls[0]?.[1]).toMatchObject({
      type: "update-properties",
      animationId: "anime-1",
      properties: { width: 101, height: 45 },
    });
  });

  it("commits rotate through the anime mutation boundary on rotation", async () => {
    const commit = vi.fn(async () => {});

    const handled = await tryAnimeRotationIntercept(
      selection,
      33.7,
      [animeAnimation({ propertyGroup: "rotation", properties: { rotate: 0 } })],
      commit,
    );

    expect(handled).toBe(true);
    expect(commit.mock.calls[0]?.[1]).toMatchObject({
      type: "update-property",
      animationId: "anime-1",
      property: "rotate",
      value: 34,
    });
  });
});
