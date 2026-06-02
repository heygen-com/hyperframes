import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl } from "./urlDownloader.js";

describe("assertPublicHttpsUrl — SSRF guard", () => {
  it("accepts public HTTPS URLs", () => {
    expect(() =>
      assertPublicHttpsUrl("https://gen-os-static.s3.us-east-2.amazonaws.com/fonts/font.ttf"),
    ).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://cdn.jsdelivr.net/npm/gsap.min.js")).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://fonts.gstatic.com/s/font.woff2")).not.toThrow();
  });

  it("rejects http:// (non-HTTPS)", () => {
    expect(() => assertPublicHttpsUrl("http://example.com/font.ttf")).toThrow("Only HTTPS");
  });

  it("rejects AWS IMDS (169.254.169.254)", () => {
    expect(() =>
      assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data/iam/security-credentials/"),
    ).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("http://169.254.169.254/latest/user-data")).toThrow();
  });

  it("rejects loopback (127.x.x.x)", () => {
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/font.ttf")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://127.1.2.3/secret")).toThrow("private/reserved");
  });

  it("rejects localhost", () => {
    expect(() => assertPublicHttpsUrl("https://localhost/font.ttf")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("http://localhost:3000/secret")).toThrow();
  });

  it("rejects RFC1918 — 10.x", () => {
    expect(() => assertPublicHttpsUrl("https://10.0.0.1/secret")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://10.255.255.255/secret")).toThrow("private/reserved");
  });

  it("rejects RFC1918 — 172.16–172.31", () => {
    expect(() => assertPublicHttpsUrl("https://172.16.0.1/secret")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://172.31.255.255/secret")).toThrow("private/reserved");
  });

  it("allows 172.0–172.15 and 172.32+ (not RFC1918)", () => {
    expect(() => assertPublicHttpsUrl("https://172.15.0.1/font.ttf")).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://172.32.0.1/font.ttf")).not.toThrow();
  });

  it("rejects RFC1918 — 192.168.x", () => {
    expect(() => assertPublicHttpsUrl("https://192.168.1.1/secret")).toThrow("private/reserved");
  });

  it("rejects unspecified address (0.x)", () => {
    expect(() => assertPublicHttpsUrl("https://0.0.0.0/secret")).toThrow("private/reserved");
  });

  it("rejects loopback IPv6 ([::1])", () => {
    expect(() => assertPublicHttpsUrl("https://[::1]/secret")).toThrow("private/reserved");
  });

  it("rejects invalid URLs", () => {
    expect(() => assertPublicHttpsUrl("not-a-url")).toThrow("Invalid URL");
    expect(() => assertPublicHttpsUrl("")).toThrow("Invalid URL");
  });
});
