import { describe, expect, it } from "vitest";
import { allowedLottieRequest, LOTTIE_RUNTIME_URL } from "./lottiePreviewRequests.js";

describe("Lottie preview request policy", () => {
  it("allows the pinned runtime and public image/font assets", () => {
    expect(allowedLottieRequest(LOTTIE_RUNTIME_URL, "script")).toBe(true);
    expect(allowedLottieRequest("https://cdn.example/image.png", "image")).toBe(true);
    expect(allowedLottieRequest("https://cdn.example/font.woff2", "font")).toBe(true);
    expect(allowedLottieRequest("data:image/png;base64,AA==", "image")).toBe(true);
  });
  it.each([
    "http://127.0.0.1/a",
    "http://169.254.169.254/a",
    "http://[::1]/a",
    "file:///etc/passwd",
  ])("blocks private and local targets %s", (url) => {
    expect(allowedLottieRequest(url, "image")).toBe(false);
  });
  it("blocks arbitrary scripts and navigations", () => {
    expect(allowedLottieRequest("https://cdn.example/script.js", "script")).toBe(false);
    expect(allowedLottieRequest("https://cdn.example/page", "document")).toBe(false);
  });
});
