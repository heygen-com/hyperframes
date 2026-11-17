// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropElementCropLift,
  isElementCropLifted,
  liftElementCrop,
  readElementCropInsets,
} from "./domEditOverlayCrop";

const sent: Array<{ lift: boolean; answer: (reply: unknown) => void }> = [];
vi.mock("../../player/lib/previewChannel", () => ({
  previewRequest: (_iframe: unknown, _kind: string, params: { lift: boolean }) =>
    new Promise((answer) => sent.push({ lift: params.lift, answer })),
}));
vi.mock("./previewDrafts", () => ({
  previewStandIn: () => ({ iframe: {}, handle: "hf-1" }),
}));

afterEach(() => {
  sent.length = 0;
});

const settle = () => new Promise((done) => setTimeout(done, 0));

async function lifted(clipPath = "inset(10px)") {
  const el = document.createElement("div");
  liftElementCrop(el);
  sent.at(-1)!.answer({ lifted: true, clipPath });
  await settle();
  return el;
}

describe("a crop lift in a frame Studio cannot script", () => {
  it("is kept when the lift's reply is lost, so deselecting still asks the frame to drop it", async () => {
    const el = document.createElement("div");
    liftElementCrop(el);
    sent[0]!.answer(null);
    await settle();
    expect(isElementCropLifted(el)).toBe(true);
    dropElementCropLift(el);
    expect(sent.map((request) => request.lift)).toEqual([true, false]);
  });

  it("asks again until the frame says the lift is gone, and only then forgets it", async () => {
    const el = await lifted();
    dropElementCropLift(el);
    sent[1]!.answer(null);
    await settle();
    expect(sent.map((request) => request.lift)).toEqual([true, false, false]);
    sent[2]!.answer({ lifted: false, clipPath: null });
    await settle();
    expect(sent).toHaveLength(3);
    expect(isElementCropLifted(el)).toBe(false);
    liftElementCrop(el);
    expect(sent.map((request) => request.lift)).toEqual([true, false, false, true]);
  });

  it("ignores a clip-path past the element value cap, and an inset past the draft limit", async () => {
    expect(readElementCropInsets(await lifted(`inset(5px) ${"x".repeat(3000)}`))).toMatchObject({
      top: 0,
    });
    expect(readElementCropInsets(await lifted("inset(200000px 0px 0px 0px)"))).toBeNull();
  });
});
