import { afterEach, describe, expect, it } from "vitest";
import { createTimingRecordFilter } from "./mutationRecords";

const recordsMoveTiming = createTimingRecordFilter(["data-start", "data-duration", "id"]);

/** Records the timing observer would see for one synchronous change. */
const recordsOf = (change: (root: HTMLElement) => void): MutationRecord[] => {
  const root = document.getElementById("root")!;
  const observer = new MutationObserver(() => {});
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-start", "data-duration", "id"],
  });
  change(root);
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
};

describe("createTimingRecordFilter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const mount = () => {
    document.body.innerHTML =
      `<div id="root"><p class="caption">Hel</p>` +
      `<div class="clip" data-start="1" data-duration="2"><span>a</span></div></div>`;
  };

  it("ignores text replaced inside an untimed element", () => {
    mount();
    const records = recordsOf((root) => {
      root.querySelector(".caption")!.textContent = "Hello";
    });
    expect(records.length).toBeGreaterThan(0);
    expect(recordsMoveTiming(records)).toBe(false);
  });

  it("ignores an inserted element that carries no timing", () => {
    mount();
    const records = recordsOf((root) => {
      root.querySelector(".clip span")!.append(document.createElement("b"));
    });
    expect(recordsMoveTiming(records)).toBe(false);
  });

  it("counts an inserted clip, and a subtree holding one", () => {
    mount();
    expect(
      recordsMoveTiming(
        recordsOf((root) => {
          const clip = document.createElement("div");
          clip.setAttribute("data-start", "4");
          root.append(clip);
        }),
      ),
    ).toBe(true);
    expect(
      recordsMoveTiming(
        recordsOf((root) => {
          const wrapper = document.createElement("section");
          wrapper.innerHTML = `<video></video>`;
          root.append(wrapper);
        }),
      ),
    ).toBe(true);
  });

  it("counts a removed clip", () => {
    mount();
    const records = recordsOf((root) => root.querySelector(".clip")!.remove());
    expect(recordsMoveTiming(records)).toBe(true);
  });

  it("counts an inserted element another clip's start can name by id", () => {
    mount();
    const records = recordsOf((root) => {
      const anchor = document.createElement("span");
      anchor.id = "intro";
      root.append(anchor);
    });
    expect(recordsMoveTiming(records)).toBe(true);
  });

  it("counts a timing attribute edit and an inserted script", () => {
    mount();
    expect(
      recordsMoveTiming(
        recordsOf((root) => root.querySelector(".clip")!.setAttribute("data-duration", "3")),
      ),
    ).toBe(true);
    expect(
      recordsMoveTiming(recordsOf((root) => root.append(document.createElement("script")))),
    ).toBe(true);
  });
});
