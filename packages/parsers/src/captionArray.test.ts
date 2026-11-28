import { describe, expect, it } from "vitest";
import {
  locateCaptionArrays,
  pickCaptionArray,
  shiftCaptionWords,
  spliceCaptionWords,
} from "./captionArray.js";

// The layout transcribe writes: JSON, one key per line, indented inside a <script>.
const transcribed = `<div class="captions"></div>
<script>
  const TRANSCRIPT = [
    {
      "id": "w0",
      "text": "Hello",
      "start": 0.1,
      "end": 0.4,
      "line": "l1"
    },
    {
      "id": "w1",
      "text": "there.",
      "start": 0.5,
      "end": 0.9,
      "line": "l1"
    },
    {
      "id": "w2",
      "text": "Bye.",
      "start": 2,
      "end": 2.3,
      "line": "l2"
    }
  ];
  build(TRANSCRIPT);
</script>`;

const compact = `let script = [{ text: "One", start: 1, end: 1.2 }, { text: "two", start: 1.3, end: 1.6 }];`;

describe("locateCaptionArrays", () => {
  it("reads every word of a transcribed array with its line tag", () => {
    const [array] = locateCaptionArrays(transcribed);
    expect(array?.name).toBe("TRANSCRIPT");
    expect(array?.keyword).toBe("const");
    expect(array?.editable).toBe(true);
    expect(array?.words.map((w) => [w.id, w.text, w.startTime, w.endTime, w.line])).toEqual([
      ["w0", "Hello", 0.1, 0.4, "l1"],
      ["w1", "there.", 0.5, 0.9, "l1"],
      ["w2", "Bye.", 2, 2.3, "l2"],
    ]);
  });

  it("finds let and var arrays with bare keys", () => {
    expect(locateCaptionArrays(compact)[0]?.words.map((w) => w.text)).toEqual(["One", "two"]);
    const withVar = compact.replace("let script", "var script");
    expect(locateCaptionArrays(withVar)[0]?.keyword).toBe("var");
  });

  it("marks an array with a computed element read-only and skips arrays that are not literals", () => {
    const computed = `const script = [{ text: "a", start: 0, end: 1 }, makeWord()];`;
    expect(locateCaptionArrays(computed)[0]?.editable).toBe(false);
    expect(locateCaptionArrays(`const script = [oops;`)).toEqual([]);
  });

  it("picks the named array, else script before TRANSCRIPT", () => {
    const both = `${transcribed}\n<script>${compact}</script>`;
    const arrays = locateCaptionArrays(both);
    expect(pickCaptionArray(arrays)?.name).toBe("script");
    expect(pickCaptionArray(arrays, "TRANSCRIPT")?.name).toBe("TRANSCRIPT");
  });
});

describe("spliceCaptionWords", () => {
  it("replaces one line's words and leaves every other element byte-identical", () => {
    const [array] = locateCaptionArrays(transcribed);
    const out = spliceCaptionWords(transcribed, array!, 0, 2, [
      { id: "l1w0", text: "Hi", start: 0.1, end: 0.3, line: "l1" },
    ]);
    const [after] = locateCaptionArrays(out);
    expect(after?.words.map((w) => [w.text, w.startTime, w.line])).toEqual([
      ["Hi", 0.1, "l1"],
      ["Bye.", 2, "l2"],
    ]);
    const untouched = transcribed.slice(array!.words[2]!.start, array!.words[2]!.end);
    expect(out).toContain(untouched);
    // Written in the array's own layout: quoted keys, one per line, same indent.
    expect(out).toContain(`{\n      "id": "l1w0",\n      "text": "Hi",`);
  });

  it("inserts into a compact array in its style and removes words with their separator", () => {
    const [array] = locateCaptionArrays(compact);
    const inserted = spliceCaptionWords(compact, array!, 1, 0, [
      { text: "and", start: 1.2, end: 1.3 },
    ]);
    expect(inserted).toBe(
      `let script = [{ text: "One", start: 1, end: 1.2 }, { text: "and", start: 1.2, end: 1.3 }, { text: "two", start: 1.3, end: 1.6 }];`,
    );
    const removed = spliceCaptionWords(compact, array!, 0, 1, []);
    expect(removed).toBe(`let script = [{ text: "two", start: 1.3, end: 1.6 }];`);
  });

  it("refuses a range outside the array", () => {
    const [array] = locateCaptionArrays(compact);
    expect(() => spliceCaptionWords(compact, array!, 1, 5, [])).toThrow(RangeError);
  });
});

describe("shiftCaptionWords", () => {
  it("moves later words by the delta and touches nothing else", () => {
    const [array] = locateCaptionArrays(transcribed);
    const out = shiftCaptionWords(transcribed, array!, 2, 0.75);
    const [after] = locateCaptionArrays(out);
    expect(after?.words.map((w) => [w.startTime, w.endTime])).toEqual([
      [0.1, 0.4],
      [0.5, 0.9],
      [2.75, 3.05],
    ]);
    expect(out.slice(0, array!.words[2]!.start)).toBe(transcribed.slice(0, array!.words[2]!.start));
  });

  it("works whatever order start and end are written in", () => {
    const reversed = `const script = [{ text: "a", end: 2, start: 1 }];`;
    const [array] = locateCaptionArrays(reversed);
    expect(shiftCaptionWords(reversed, array!, 0, 1)).toBe(
      `const script = [{ text: "a", end: 3, start: 2 }];`,
    );
  });
});
