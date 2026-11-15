import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const LATIN = ["bright", "camera", "moment", "simple", "render", "motion"];
const KOREAN = ["오늘", "영상", "처음", "공개", "끝까지", "감사"];
const CYRILLIC = ["сегодня", "невероятно", "показываем", "результат", "спасибо", "друзья"];
const LATIN_LONG = ["segodnya", "neveroyatn", "pokazyvaem", "rezultatt", "spasibo", "druzyaa"];

function source(name: string): string {
  const url = new URL(`../../../../registry/components/${name}/${name}.html`, import.meta.url);
  return readFileSync(url, "utf8");
}

function withTranscript(html: string, words: string[], step = 0.5): string {
  const list = words.map(
    (text, i) => `{ text: "${text}", start: ${i * step}, end: ${i * step + 0.2} }`,
  );
  return html.replace(/var TRANSCRIPT = \[[\s\S]*?\];/, `var TRANSCRIPT = [${list.join(",")}];`);
}

function withKeywords(html: string, words: string[]): string {
  return html.replace(
    /var KEYWORDS = new Set\(\[[^\]]*\]\);/,
    `var KEYWORDS = new Set(${JSON.stringify(words)});`,
  );
}

/** Runs the component's inline script; returns its document and how many tweens it scheduled. */
function run(html: string): { document: Window["document"]; tweens: number } {
  const window = new Window({
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true },
  });
  window.document.write(html);
  const scripts = [...window.document.querySelectorAll("script")];
  const script = scripts.filter((el) => !el.hasAttribute("src")).at(-1)!.textContent;
  for (const el of scripts) el.remove();
  const canvasContext = { font: "", measureText: () => ({ width: 0 }) };
  window.HTMLCanvasElement.prototype.getContext = (() =>
    canvasContext) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
  let tweens = 0;
  const tl: Record<string, () => unknown> = {};
  for (const method of ["set", "seek", "add", "call"]) tl[method] = () => tl;
  for (const method of ["to", "from", "fromTo"]) {
    tl[method] = () => {
      tweens += 1;
      return tl;
    };
  }
  const gsap = { timeline: () => tl, set: () => undefined, to: () => undefined };
  vm.runInNewContext(script, { window, document: window.document, gsap, console });
  return { document: window.document, tweens };
}

function wordColors(html: string): string[] {
  const words = [...run(html).document.querySelectorAll(".caption-word")];
  return words.map((el) => (el as unknown as { style: { color: string } }).style.color);
}

describe("caption components with a transcript that is not in Latin letters", () => {
  it("caption-emoji-pop shows the emoji mapped to a Korean word", () => {
    const html = withTranscript(source("caption-emoji-pop"), KOREAN).replace(
      /var WORD_EMOJI = \{[\s\S]*?\};/,
      'var WORD_EMOJI = { 영상: "📹" };',
    );
    const emoji = [...run(html).document.querySelectorAll(".caption-emoji")];
    expect(emoji.map((el) => el.textContent)).toEqual(["📹"]);
  });

  it.each(["caption-emoji-pop", "caption-neon-accent"])(
    "%s accents Korean keywords the way it accents Latin ones",
    (name) => {
      const latin = wordColors(withKeywords(withTranscript(source(name), LATIN), LATIN));
      const korean = wordColors(withKeywords(withTranscript(source(name), KOREAN), KOREAN));
      expect(latin).toHaveLength(LATIN.length);
      expect(korean).toEqual(latin);
    },
  );

  it("caption-glitch-rgb gives a long Cyrillic word the aftershock a long Latin word gets", () => {
    const tweens = (words: string[]) =>
      run(withTranscript(source("caption-glitch-rgb"), words, 0.47)).tweens;
    const [short, latin, cyrillic] = [tweens(LATIN), tweens(LATIN_LONG), tweens(CYRILLIC)];
    expect(latin).toBeGreaterThan(short);
    expect(cyrillic).toBe(latin);
  });
});
