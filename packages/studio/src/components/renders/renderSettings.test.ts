// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  getPersistedRenderSettings,
  getRenderSettings,
  persistRenderSettings,
  updatePersistedRenderSettings,
} from "./renderSettings";

const key = "hf-studio-render-settings";
beforeEach(() => localStorage.clear());

describe("render settings persistence", () => {
  it("keeps the published default getter and positional writer compatible", () => {
    expect(getPersistedRenderSettings()).toEqual({
      format: "mp4",
      quality: "standard",
      fps: 30,
      gpu: false,
    });
    persistRenderSettings("webm", "high", 60);
    expect(getPersistedRenderSettings()).toEqual({
      format: "webm",
      quality: "high",
      fps: 60,
      gpu: false,
    });
    expect(getRenderSettings()).toMatchObject({
      rateControl: { mode: "auto" },
      videoFrameFormat: "auto",
      hdrMode: "auto",
    });
  });

  it("retains new overrides when a legacy caller changes basic settings", () => {
    updatePersistedRenderSettings({
      rateControl: { mode: "crf", value: 0 },
      videoFrameFormat: "png",
      hdrMode: "force-sdr",
      gpu: true,
    });
    persistRenderSettings("webm", "draft", 24);
    expect(getPersistedRenderSettings()).toEqual({
      format: "webm",
      quality: "draft",
      fps: 24,
      gpu: true,
      rateControl: { mode: "crf", value: 0 },
      videoFrameFormat: "png",
      hdrMode: "force-sdr",
    });
  });

  it.each([
    "{",
    "null",
    "[]",
    '{"format":"bad","quality":false,"fps":"60","rateControl":{"mode":"crf","value":52},"videoFrameFormat":"gif","hdrMode":"yes"}',
  ])("safely reads malformed/old storage %s", (raw) => {
    localStorage.setItem(key, raw);
    expect(getRenderSettings()).toEqual({
      format: "mp4",
      quality: "standard",
      fps: 30,
      gpu: false,
      rateControl: { mode: "auto" },
      videoFrameFormat: "auto",
      hdrMode: "auto",
    });
  });

  it("preserves valid legacy fields and defaults absent advanced fields", () => {
    localStorage.setItem(key, JSON.stringify({ format: "mov", quality: "high", fps: 60 }));
    expect(getRenderSettings()).toMatchObject({
      format: "mov",
      quality: "high",
      fps: 60,
      gpu: false,
      rateControl: { mode: "auto" },
    });
  });

  it("clears a WebM-only CRF on MP4 and clears persisted rate on MOV", () => {
    updatePersistedRenderSettings({ format: "webm", rateControl: { mode: "crf", value: 63 } });
    expect(updatePersistedRenderSettings({ format: "mp4" }).rateControl).toEqual({ mode: "auto" });
    updatePersistedRenderSettings({
      rateControl: { mode: "bitrate", value: " 1.5M " },
      hdrMode: "force-hdr",
    });
    expect(getRenderSettings().rateControl).toEqual({ mode: "bitrate", value: "1.5M" });
    expect(updatePersistedRenderSettings({ format: "mov" })).toMatchObject({
      rateControl: { mode: "auto" },
      hdrMode: "force-hdr",
    });
    expect(updatePersistedRenderSettings({ format: "mp4" }).rateControl).toEqual({ mode: "auto" });
  });

  it("persists Auto as an actual reset, preserving unrelated settings", () => {
    updatePersistedRenderSettings({
      gpu: true,
      rateControl: { mode: "crf", value: 18 },
      videoFrameFormat: "png",
      hdrMode: "force-hdr",
    });
    updatePersistedRenderSettings({
      rateControl: { mode: "auto" },
      videoFrameFormat: "auto",
      hdrMode: "auto",
      fps: undefined,
    });
    expect(getPersistedRenderSettings()).toEqual({
      format: "mp4",
      quality: "standard",
      fps: 30,
      gpu: true,
    });
  });
});
