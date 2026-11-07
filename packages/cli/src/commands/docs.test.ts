import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderMarkdown } from "./docs.js";

describe("renderMarkdown", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv as NodeJS.ProcessEnv;
  });

  it("strips **bold** markers from output", () => {
    const content = "This is **bold** text and **another** bold.";
    // Capture console.log by overriding it
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(Array.from(args).join(" "));
    };

    renderMarkdown(content);

    console.log = originalLog;

    const combined = logs.join("\n");
    expect(combined).not.toContain("**bold**");
    expect(combined).not.toContain("**another**");
    expect(combined).toContain("bold");
    expect(combined).toContain("another bold");
  });

  it("preserves text without bold markers", () => {
    const content = "This is normal text without any markup.";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(Array.from(args).join(" "));
    };

    renderMarkdown(content);

    console.log = originalLog;

    expect(logs.join("\n")).toContain("normal text without any markup.");
  });

  it("handles bold at start of line", () => {
    const content = "**Hello** world";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(Array.from(args).join(" "));
    };

    renderMarkdown(content);

    console.log = originalLog;

    expect(logs.join("\n")).toContain("Hello world");
    expect(logs.join("\n")).not.toContain("**Hello**");
  });

  it("handles multiple bold sections on same line", () => {
    const content = "**a** and **b** and **c**";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(Array.from(args).join(" "));
    };

    renderMarkdown(content);

    console.log = originalLog;

    expect(logs.join("\n")).toMatch(/a and b and c/);
    expect(logs.join("\n")).not.toMatch(/\*\*.*\*\*/);
  });
});