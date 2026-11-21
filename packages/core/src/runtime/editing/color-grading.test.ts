import { afterEach, describe, expect, it, vi } from "vitest";
import { installMarkedEditingAgent } from "../editingAgent.test-helpers";

const CONNECT = { source: "hf-parent", type: "editing-connect", v: 1 };
const target = { id: "clip", hfId: null, selector: "#clip", selectorIndex: 0 };

let agent: { dispose: () => void } | null = null;
afterEach(() => {
  agent?.dispose();
  agent = null;
  delete window.__hf;
  document.body.innerHTML = "";
});

function connect(): MessagePort {
  const parent = document.body.appendChild(document.createElement("iframe")).contentWindow!;
  const handoff = vi.fn();
  parent.postMessage = handoff as unknown as Window["postMessage"];
  agent = installMarkedEditingAgent(parent);
  window.dispatchEvent(new MessageEvent("message", { source: parent, data: CONNECT }));
  return (handoff.mock.calls[0]![2] as MessagePort[])[0]!;
}

let nextId = 1;
function ask(port: MessagePort, kind: string, params: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    port.onmessage = (event) => resolve(event.data);
    port.postMessage({ v: 1, id: nextId++, kind, params });
  });
}

function installGrading() {
  const stop = vi.fn();
  const grading = {
    getStatus: vi.fn(() => ({ state: "active", message: "Shader active" })),
    renderPreviews: vi.fn(async () => ({
      width: 160,
      height: 90,
      images: [{ id: "warm", dataUrl: "data:image/png;base64,x" }],
    })),
    startPreviewPlayback: vi.fn(() => stop),
  };
  window.__hf = { colorGrading: grading as never };
  return { grading, stop };
}

describe("colour grading kinds", () => {
  it("answers with the frame's grading runtime", async () => {
    const { grading, stop } = installGrading();
    const port = connect();
    const candidates = [{ id: "warm", grading: { preset: "warm-daylight" } }];

    expect((await ask(port, "color-grading-status", { target })).result).toEqual({
      status: { state: "active", message: "Shader active" },
    });
    const previews = await ask(port, "color-grading-previews", {
      target,
      candidates,
      maxDimension: 160,
      useMediaTime: true,
    });
    expect(previews.result).toEqual({
      batch: {
        width: 160,
        height: 90,
        images: [{ id: "warm", dataUrl: "data:image/png;base64,x" }],
      },
    });
    expect(grading.renderPreviews).toHaveBeenCalledWith(target, candidates, {
      maxDimension: 160,
      useMediaTime: true,
    });

    expect((await ask(port, "color-grading-playback", { target })).result).toEqual({
      started: true,
    });
    expect(grading.startPreviewPlayback).toHaveBeenCalledWith(target);
    expect((await ask(port, "color-grading-playback", { target: null })).result).toEqual({
      started: false,
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("answers null when the page has no grading runtime", async () => {
    const port = connect();
    expect((await ask(port, "color-grading-status", { target })).result).toEqual({ status: null });
    const previews = await ask(port, "color-grading-previews", {
      target,
      candidates: [{ id: "a", grading: null }],
      maxDimension: 160,
      useMediaTime: false,
    });
    expect(previews.result).toEqual({ batch: null });
    expect((await ask(port, "color-grading-playback", { target })).result).toEqual({
      started: false,
    });
  });

  const previews = { target, candidates: [{ id: "a", grading: null }], maxDimension: 160 };
  it.each([
    ["color-grading-status", {}],
    ["color-grading-status", { target: "#clip" }],
    ["color-grading-status", { target: { id: "clip" } }],
    ["color-grading-status", { target: { ...target, selector: "p".repeat(2001) } }],
    ["color-grading-status", { target: { ...target, selectorIndex: -1 } }],
    ["color-grading-status", { target, extra: 1 }],
    ["color-grading-previews", { ...previews }],
    ["color-grading-previews", { ...previews, useMediaTime: false, maxDimension: 321 }],
    ["color-grading-previews", { ...previews, useMediaTime: false, maxDimension: 0 }],
    ["color-grading-previews", { ...previews, useMediaTime: false, candidates: [] }],
    [
      "color-grading-previews",
      { ...previews, useMediaTime: false, candidates: Array(65).fill({ id: "a", grading: null }) },
    ],
    ["color-grading-previews", { ...previews, useMediaTime: false, candidates: [{ id: "a" }] }],
    [
      "color-grading-previews",
      { ...previews, useMediaTime: false, candidates: [{ id: "a", grading: "warm" }] },
    ],
    ["color-grading-playback", {}],
    ["color-grading-playback", { target: { id: 1 } }],
  ])("rejects %s %j", async (kind, params) => {
    const { grading } = installGrading();
    const reply = await ask(connect(), kind, params);
    expect(reply).toMatchObject({ ok: false, error: { code: "invalid-params" } });
    expect(grading.getStatus).not.toHaveBeenCalled();
    expect(grading.renderPreviews).not.toHaveBeenCalled();
    expect(grading.startPreviewPlayback).not.toHaveBeenCalled();
  });
});
