import { describe, expect, it } from "vitest";
import type { RegistryItem } from "@hyperframes/core";
import { assertSafeTarget, runtimeMismatchWarning } from "./installer.js";

const DEST = "/tmp/hf-install-test";

describe("assertSafeTarget", () => {
  it("allows simple relative paths", () => {
    expect(() => assertSafeTarget(DEST, "index.html")).not.toThrow();
    expect(() => assertSafeTarget(DEST, "compositions/intro.html")).not.toThrow();
    expect(() => assertSafeTarget(DEST, "assets/nested/deep/file.svg")).not.toThrow();
  });

  it("rejects `..` path segments", () => {
    expect(() => assertSafeTarget(DEST, "../escape.html")).toThrow(/\.\./);
    expect(() => assertSafeTarget(DEST, "compositions/../../escape.html")).toThrow(/\.\./);
    expect(() => assertSafeTarget(DEST, "a/b/../../../escape.html")).toThrow();
  });

  it("rejects Unix absolute paths", () => {
    expect(() => assertSafeTarget(DEST, "/etc/passwd")).toThrow(/absolute/);
    expect(() => assertSafeTarget(DEST, "/home/user/file.txt")).toThrow();
  });

  it("rejects Windows drive-letter paths", () => {
    expect(() => assertSafeTarget(DEST, "C:/Windows/System32")).toThrow(/Windows/);
    expect(() => assertSafeTarget(DEST, "D:\\notes.txt")).toThrow();
  });

  it("allows `.` segments (no-op) and dotfile-like names", () => {
    expect(() => assertSafeTarget(DEST, ".hidden")).not.toThrow();
    expect(() => assertSafeTarget(DEST, "./file.html")).not.toThrow();
    expect(() => assertSafeTarget(DEST, "a..b/file.html")).not.toThrow();
  });
});

const ITEM: RegistryItem = {
  name: "caption-pop",
  type: "hyperframes:block",
  title: "Caption Pop",
  description: "Runtime warning fixture",
  dimensions: { width: 1920, height: 1080 },
  duration: 2,
  files: [
    {
      path: "caption-pop.html",
      target: "compositions/caption-pop.html",
      type: "hyperframes:composition",
    },
  ],
};

describe("runtimeMismatchWarning", () => {
  it("returns null when the project runtime is ambiguous", () => {
    expect(runtimeMismatchWarning({ ...ITEM, runtime: "animejs" }, undefined)).toBeNull();
  });

  it("defaults absent item runtime to gsap", () => {
    expect(runtimeMismatchWarning(ITEM, "gsap")).toBeNull();
    expect(runtimeMismatchWarning(ITEM, "animejs")).toContain('"caption-pop"');
    expect(runtimeMismatchWarning(ITEM, "animejs")).toContain("gsap");
  });

  it("warns symmetrically for mismatched explicit runtimes", () => {
    expect(runtimeMismatchWarning({ ...ITEM, runtime: "gsap" }, "animejs")).toContain(
      "project appears to use animejs",
    );
    expect(runtimeMismatchWarning({ ...ITEM, runtime: "animejs" }, "gsap")).toContain(
      "project appears to use gsap",
    );
  });
});
