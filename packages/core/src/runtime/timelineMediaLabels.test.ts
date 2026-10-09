import { describe, it, expect, afterEach } from "vitest";
import { collectRuntimeTimelinePayload } from "./timeline";

describe("media timeline labels", () => {
  const defaultParams = { canonicalFps: 30 };
  afterEach(() => {
    document.body.innerHTML = "";
  });
  it.each(["video", "audio", "img"])(
    "preserves an authored %s id after replacing its source",
    (tag) => {
      document.body.innerHTML = `<div data-composition-id="main" data-duration="10">
      <${tag} id="harbor" class="clip harbor" src="assets/harbor.mp4"
        data-start="0" data-duration="5"></${tag}>
    </div>`;
      expect(collectRuntimeTimelinePayload(defaultParams).clips[0].label).toBe("Harbor");
      document.getElementById("harbor")!.setAttribute("src", "assets/library.mp4");
      expect(collectRuntimeTimelinePayload(defaultParams).clips[0].label).toBe("Harbor");
    },
  );

  it.each([
    ["Harbor%20Sunset.mp4", "Harbor Sunset"],
    ["%E6%B5%B7%E6%B8%AF.mp4", "海港"],
    ["Harbor%.mp4?v=1.2", "Harbor%"],
  ])("decodes the generated label from %s", (filename, label) => {
    document.body.innerHTML = `<div data-composition-id="main" data-duration="10">
      <video src="assets/${filename}" data-start="0" data-duration="5"></video>
    </div>`;
    expect(collectRuntimeTimelinePayload(defaultParams).clips[0].label).toBe(label);
  });

  it("decodes a generated filename without a usable document base URL", () => {
    const base = document.createElement("base");
    base.href = "about:blank";
    document.head.appendChild(base);
    try {
      expect(document.baseURI).toBe("about:blank");
      document.body.innerHTML = `<div data-composition-id="main" data-duration="10">
        <video src="assets/Harbor%20Sunset.mp4?v=1.2"
          data-start="0" data-duration="5"></video>
      </div>`;
      expect(collectRuntimeTimelinePayload(defaultParams).clips[0].label).toBe("Harbor Sunset");
    } finally {
      base.remove();
    }
  });

  it.each(["data-timeline-label", "data-label", "aria-label"])(
    "preserves an authored %s after replacing a media source",
    (attribute) => {
      document.body.innerHTML = `<div data-composition-id="main" data-duration="10">
        <video id="harbor" src="assets/harbor.mp4" data-start="0" data-duration="5"></video>
      </div>`;
      const clip = document.getElementById("harbor")!;
      clip.setAttribute(attribute, "Opening Shot");
      clip.setAttribute("src", "assets/library.mp4");
      expect(collectRuntimeTimelinePayload(defaultParams).clips[0].label).toBe("Opening Shot");
    },
  );
});
