// @vitest-environment happy-dom
import { analyzeClipMediaFit } from "@hyperframes/engine";
import type { Page } from "puppeteer-core";
import { afterEach, describe, expect, it } from "vitest";
import { auditClipDurations } from "./validate.js";

afterEach(() => {
  document.body.innerHTML = "";
});

async function auditAudio(attributes: string, sourceDuration: number) {
  document.body.innerHTML = `<audio id="voice" ${attributes}></audio>`;
  const audio = document.querySelector("audio");
  if (!audio) throw new Error("Missing fixture audio");
  Object.defineProperty(audio, "duration", { value: sourceDuration });

  const evaluate: Page["evaluate"] = async (fn, ...args) => {
    if (typeof fn !== "function") throw new Error("Expected a browser function");
    return window.eval(`(${fn.toString()})`)(...args);
  };
  return auditClipDurations({ evaluate }, analyzeClipMediaFit, 0);
}

describe("audio slot fit at the authored playback speed", () => {
  it.each([
    { name: "normal speed", attributes: 'data-duration="1"', sourceDuration: 1 },
    {
      name: "half speed",
      attributes: 'data-duration="2" data-playback-rate=".5"',
      sourceDuration: 1,
    },
    {
      name: "trimmed half speed",
      attributes: 'data-duration="4" data-media-start="2" data-playback-rate=".5"',
      sourceDuration: 4,
    },
    {
      name: "rate lane overriding the constant rate",
      attributes: `data-duration="2" data-playback-rate="2"
        data-automation='{"version":1,"lanes":[{"target":"rate","points":[{"t":0,"v":0.5},{"t":2,"v":0.5}]}]}'`,
      sourceDuration: 1,
    },
    {
      name: "rising rate lane",
      attributes: `data-duration="2"
        data-automation='{"version":1,"lanes":[{"target":"rate","points":[{"t":0,"v":0.5},{"t":2,"v":1}]}]}'`,
      sourceDuration: 1.5,
    },
    {
      name: "canonical trim overriding the legacy offset",
      attributes:
        'data-duration="4" data-playback-start="2" data-media-start="3" data-playback-rate=".5"',
      sourceDuration: 4,
    },
    {
      name: "looping fast audio",
      attributes: 'data-duration="2" data-playback-rate="2" loop',
      sourceDuration: 1,
    },
  ])("does not flag $name when it fills the slot", async ({ attributes, sourceDuration }) => {
    expect(await auditAudio(attributes, sourceDuration)).toEqual([]);
  });

  it.each([
    { name: "normal speed", attributes: 'data-duration="2"', expected: "1.00" },
    {
      name: "double speed",
      attributes: 'data-duration="1" data-playback-rate="2"',
      expected: "0.50",
    },
  ])("reports the playable timeline length at $name", async ({ attributes, expected }) => {
    const warnings = await auditAudio(attributes, 1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain(`Audio "voice" is ${expected}s`);
    expect(warnings[0]?.text).toContain(`Set data-duration to ~${expected}s`);
  });
});
