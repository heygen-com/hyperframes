import { describe, expect, it } from "vitest";
import { detectBlockedPage } from "./pageBlockDetection.js";

describe("detectBlockedPage", () => {
  it.each([
    {
      label: "local Fuji response",
      evidence: {
        httpStatus: 403,
        title: "403 - Forbidden",
        textLength: 50,
        bodyChildCount: 1,
        hasChallengeElement: false,
      },
    },
    {
      label: "EC2-style soft-block response",
      evidence: {
        httpStatus: 200,
        title: "Access denied",
        textLength: 18,
        bodyChildCount: 2,
        hasChallengeElement: false,
      },
    },
    {
      label: "classic Cloudflare interstitial",
      evidence: {
        httpStatus: 503,
        title: "Attention Required! | Cloudflare",
        textLength: 120,
        bodyChildCount: 3,
        hasChallengeElement: false,
      },
    },
  ])("rejects a minimal protection page: $label", ({ evidence }) => {
    expect(detectBlockedPage(evidence)).toMatch(/capture blocked/i);
  });

  it("rejects a structural challenge on a minimal page", () => {
    expect(
      detectBlockedPage({
        httpStatus: 200,
        title: "Please verify you are human",
        textLength: 300,
        bodyChildCount: 3,
        hasChallengeElement: true,
      }),
    ).toMatch(/capture blocked/i);
  });

  it.each([
    {
      label: "an image-led page with little text",
      evidence: {
        httpStatus: 200,
        title: "Photography portfolio",
        textLength: 18,
        bodyChildCount: 4,
        hasChallengeElement: false,
      },
    },
    {
      label: "a real page discussing access denial",
      evidence: {
        httpStatus: 200,
        title: "Why websites say Access Denied",
        textLength: 2_000,
        bodyChildCount: 20,
        hasChallengeElement: false,
      },
    },
    {
      label: "a full page with an embedded CAPTCHA",
      evidence: {
        httpStatus: 200,
        title: "Contact us",
        textLength: 2_000,
        bodyChildCount: 20,
        hasChallengeElement: true,
      },
    },
    {
      label: "a minimal photography page named Forbidden Fruit Photography",
      evidence: {
        httpStatus: 200,
        title: "Forbidden Fruit Photography",
        textLength: 40,
        bodyChildCount: 4,
        hasChallengeElement: false,
      },
    },
    {
      label: "a minimal photo essay named Attention Required",
      evidence: {
        httpStatus: 200,
        title: "Attention Required: A Photo Essay",
        textLength: 60,
        bodyChildCount: 5,
        hasChallengeElement: false,
      },
    },
  ])("allows $label", ({ evidence }) => {
    expect(detectBlockedPage(evidence)).toBeUndefined();
  });
});
