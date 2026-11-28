import { afterEach, expect, it, vi } from "vitest";
import { PAGE_LEFT, PAGE_SHOWN } from "./editingPort";
import { announcePageLife } from "./editingAgent";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

function announced() {
  const postMessage = vi.fn();
  stops.push(announcePageLife({ postMessage } as unknown as Window));
  const types = () => postMessage.mock.calls.map(([message]) => message.type);
  const pages = () => new Set(postMessage.mock.calls.map(([message]) => message.page));
  return { types, pages };
}

it("tells the parent the page started, then once that it went on pagehide", () => {
  const { types, pages } = announced();
  expect(types()).toEqual([PAGE_SHOWN]);
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new Event("pagehide"));
  expect(types()).toEqual([PAGE_SHOWN, PAGE_LEFT]);
  expect(pages().size).toBe(1);
});

it("tells the parent the page is going as soon as a navigation starts", () => {
  const { types } = announced();
  window.dispatchEvent(new Event("beforeunload"));
  window.dispatchEvent(new Event("pagehide"));
  expect(types()).toEqual([PAGE_SHOWN, PAGE_LEFT]);
});

it("tells the parent the page went when another document replaces it in place", async () => {
  const { types } = announced();
  const original = document.documentElement;
  const replacement = document.createElement("html");
  document.replaceChild(replacement, original);
  await Promise.resolve();
  document.replaceChild(original, replacement);
  expect(types()).toEqual([PAGE_SHOWN, PAGE_LEFT]);
});
