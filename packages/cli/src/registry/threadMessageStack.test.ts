import { describe, expect, it } from "vitest";
import {
  THREAD_MESSAGE_STACK_DATA_SELECTOR,
  materializeThreadMessageStack,
  parseThreadMessageStackData,
  type ThreadMessageStackData,
} from "./threadMessageStack.js";

const SOURCE = `<!doctype html>
<html><body>
<div hidden data-hf-primitive-data>{"messages":[],"stagger":0.7,"hold":1}</div>
<script>window.keepEditable = true;</script>
</body></html>`;

function data(count: number): ThreadMessageStackData {
  return {
    messages: Array.from({ length: count }, (_, index) => ({
      side: index % 2 === 0 ? "incoming" : "outgoing",
      text: `message-${index}`,
      sender: index === 0 ? "Support" : "",
    })),
    stagger: 0.42,
    hold: 1.25,
  };
}

function outsideDataBlock(source: string): string {
  return source.replace(/(<div[^>]*data-hf-primitive-data[^>]*>)[\s\S]*?(<\/div>)/, "$1__DATA__$2");
}

describe("thread-message-stack materialization", () => {
  for (const count of [1, 6, 20]) {
    it(`preserves all ${count} messages in order without truncation`, () => {
      const materialized = materializeThreadMessageStack(SOURCE, data(count));
      const parsed = parseThreadMessageStackData(materialized);

      expect(parsed.messages).toHaveLength(count);
      expect(parsed.messages.map((message) => message.text)).toEqual(
        data(count).messages.map((message) => message.text),
      );
      expect(outsideDataBlock(materialized)).toBe(outsideDataBlock(SOURCE));
      expect(materialized).toContain(THREAD_MESSAGE_STACK_DATA_SELECTOR);
    });
  }

  it("preserves deliberate long content and empty optional scalar values", () => {
    const longText = "A".repeat(8_192);
    const payload: ThreadMessageStackData = {
      messages: [{ side: "incoming", text: longText, sender: "" }],
      stagger: 0,
      hold: 0,
    };

    const parsed = parseThreadMessageStackData(materializeThreadMessageStack(SOURCE, payload));
    expect(parsed).toEqual(payload);
  });

  it("rejects malformed, oversized, or ambiguous data blocks", () => {
    expect(() =>
      materializeThreadMessageStack(SOURCE, {
        messages: [{ side: "middle" as "incoming", text: "bad" }],
      }),
    ).toThrow(/side/);
    expect(() =>
      materializeThreadMessageStack(SOURCE, {
        messages: [{ side: "incoming", text: "x".repeat(8_193) }],
      }),
    ).toThrow(/8192/);
    expect(() => materializeThreadMessageStack(SOURCE, { messages: [] })).toThrow(/at least one/);
    expect(() => materializeThreadMessageStack(SOURCE + SOURCE, data(1))).toThrow(/exactly one/);
  });
});
