/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { parseHtml, updateElementInHtml, addElementToHtml, removeElementFromHtml, validateCompositionHtml, extractCompositionMetadata } from "./htmlParser.js";

describe("parseHtml", () => {
  it("extracts elements with data-start and data-end", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <div id="text1" data-start="0" data-end="5" data-name="Title"><div>Hello World</div></div>
          <div id="text2" data-start="2" data-end="7" data-name="Subtitle"><div>Sub</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.elements).toHaveLength(2);
    expect(result.elements[0].id).toBe("text1");
    expect(result.elements[0].startTime).toBe(0);
    expect(result.elements[0].duration).toBe(5);
    expect(result.elements[0].name).toBe("Title");
    expect(result.elements[0].type).toBe("text");

    expect(result.elements[1].id).toBe("text2");
    expect(result.elements[1].startTime).toBe(2);
    expect(result.elements[1].duration).toBe(5);
  });

  it("handles nested compositions", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <div id="comp1" data-start="0" data-end="10" data-type="composition" data-composition-id="abc123">
            <iframe src="/compositions/abc123"></iframe>
          </div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].type).toBe("composition");
    expect(result.elements[0].id).toBe("comp1");
    if (result.elements[0].type === "composition") {
      expect(result.elements[0].compositionId).toBe("abc123");
      expect(result.elements[0].src).toBe("/compositions/abc123");
    }
  });

  it("extracts media elements (video, audio, img)", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <video id="vid1" data-start="0" data-end="10" src="video.mp4" data-name="My Video"></video>
          <audio id="aud1" data-start="0" data-end="5" src="music.mp3" data-name="Music"></audio>
          <img id="img1" data-start="2" data-end="8" src="photo.jpg" data-name="Photo" />
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.elements).toHaveLength(3);

    const video = result.elements.find((e) => e.id === "vid1");
    expect(video).toBeDefined();
    expect(video?.type).toBe("video");
    if (video?.type === "video") {
      expect(video.src).toBe("video.mp4");
    }

    const audio = result.elements.find((e) => e.id === "aud1");
    expect(audio).toBeDefined();
    expect(audio?.type).toBe("audio");

    const img = result.elements.find((e) => e.id === "img1");
    expect(img).toBeDefined();
    expect(img?.type).toBe("image");
  });

  it("handles missing attributes gracefully", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <div id="el1" data-start="3"><div>Some text</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].startTime).toBe(3);
    // Default duration is 5 when data-end is missing
    expect(result.elements[0].duration).toBe(5);
  });

  it("assigns generated ids when elements have no id", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <div data-start="0" data-end="5"><div>No ID</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].id).toMatch(/^element-\d+$/);
  });

  it("extracts GSAP script from script tags", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <div id="text1" data-start="0" data-end="5"><div>Hello</div></div>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
        <script>
          const tl = gsap.timeline({ paused: true });
          tl.to("#text1", { opacity: 1, duration: 1 }, 0);
        </script>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.gsapScript).not.toBeNull();
    expect(result.gsapScript).toContain("gsap.timeline");
    expect(result.gsapScript).toContain('tl.to("#text1"');
  });

  it("extracts styles from style tags", () => {
    const html = `
      <html>
      <body>
        <style data-hf-custom="true">
          .my-class { color: red; }
        </style>
        <div id="stage">
          <div id="text1" data-start="0" data-end="5"><div>Hello</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.styles).not.toBeNull();
    expect(result.styles).toContain(".my-class");
  });

  it("detects landscape resolution from data attribute", () => {
    const html = `
      <html data-resolution="landscape">
      <body>
        <div id="stage">
          <div id="text1" data-start="0" data-end="5"><div>Hello</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.resolution).toBe("landscape");
  });

  it("detects portrait resolution from data attribute", () => {
    const html = `
      <html data-resolution="portrait">
      <body>
        <div id="stage">
          <div id="text1" data-start="0" data-end="5"><div>Hello</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.resolution).toBe("portrait");
  });

  it("defaults to portrait when no resolution info is available", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <div id="text1" data-start="0" data-end="5"><div>Hello</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.resolution).toBe("portrait");
  });

  it("extracts x, y, scale, opacity from data attributes", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <video id="vid1" data-start="0" data-end="5" src="v.mp4" data-x="100" data-y="200" data-scale="1.5" data-opacity="0.8"></video>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.elements[0].x).toBe(100);
    expect(result.elements[0].y).toBe(200);
    expect(result.elements[0].scale).toBe(1.5);
    expect(result.elements[0].opacity).toBe(0.8);
  });

  it("parses text element properties (color, fontSize, fontWeight, fontFamily)", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <div id="text1" data-start="0" data-end="5" data-color="red" data-font-size="72" data-font-weight="900" data-font-family="Montserrat"><div>Styled</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    const textEl = result.elements[0];
    expect(textEl.type).toBe("text");
    if (textEl.type === "text") {
      expect(textEl.color).toBe("red");
      expect(textEl.fontSize).toBe(72);
      expect(textEl.fontWeight).toBe(900);
      expect(textEl.fontFamily).toBe("Montserrat");
    }
  });

  it("parses media element properties (mediaStartTime, sourceDuration, volume)", () => {
    const html = `
      <html>
      <body>
        <div id="stage">
          <video id="vid1" data-start="0" data-end="10" src="v.mp4" data-media-start="5" data-source-duration="30" data-volume="0.5" data-has-audio="true"></video>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    const vid = result.elements[0];
    expect(vid.type).toBe("video");
    if (vid.type === "video") {
      expect(vid.mediaStartTime).toBe(5);
      expect(vid.sourceDuration).toBe(30);
      expect(vid.volume).toBe(0.5);
      expect(vid.hasAudio).toBe(true);
    }
  });

  it("extracts data-keyframes attribute", () => {
    const keyframes = JSON.stringify([
      { id: "kf1", time: 0, properties: { opacity: 0 } },
      { id: "kf2", time: 1, properties: { opacity: 1 } },
    ]);
    const html = `
      <html>
      <body>
        <div id="stage">
          <div id="text1" data-start="0" data-end="5" data-keyframes='${keyframes}'><div>Hello</div></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.keyframes["text1"]).toBeDefined();
    expect(result.keyframes["text1"]).toHaveLength(2);
    expect(result.keyframes["text1"][0].id).toBe("kf1");
  });

  it("parses stage zoom keyframes", () => {
    const zoomKeyframes = JSON.stringify([
      { id: "z1", time: 0, zoom: { scale: 1, focusX: 960, focusY: 540 } },
      { id: "z2", time: 2, zoom: { scale: 2, focusX: 500, focusY: 300 } },
    ]);
    const html = `
      <html>
      <body>
        <div id="stage">
          <div id="stage-zoom-container" data-zoom-keyframes='${zoomKeyframes}'></div>
        </div>
      </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.stageZoomKeyframes).toHaveLength(2);
    expect(result.stageZoomKeyframes[0].zoom.scale).toBe(1);
    expect(result.stageZoomKeyframes[1].zoom.scale).toBe(2);
  });

  it("returns empty zoom keyframes when no zoom container exists", () => {
    const html = `
      <html>
      <body><div id="stage"></div></body>
      </html>
    `;
    const result = parseHtml(html);
    expect(result.stageZoomKeyframes).toHaveLength(0);
  });
});

describe("updateElementInHtml", () => {
  it("updates startTime and duration", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div id="el1" data-start="0" data-end="5"><div>Hello</div></div>
</body></html>`;

    const updated = updateElementInHtml(html, "el1", { startTime: 2, duration: 3 });

    expect(updated).toContain('data-start="2"');
    expect(updated).toContain('data-end="5"'); // data-end gets set to start + duration
  });

  it("updates element name", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div id="el1" data-start="0" data-end="5" data-name="Old"><div>Hello</div></div>
</body></html>`;

    const updated = updateElementInHtml(html, "el1", { name: "New Name" });

    expect(updated).toContain('data-name="New Name"');
  });

  it("returns original html when element not found", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div id="el1" data-start="0" data-end="5"><div>Hello</div></div>
</body></html>`;

    const updated = updateElementInHtml(html, "nonexistent", { name: "Test" });

    expect(updated).toBe(html);
  });
});

describe("addElementToHtml", () => {
  it("adds a new text element to the HTML", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div id="stage">
    <div id="stage-zoom-container"></div>
  </div>
</body></html>`;

    const { html: updated, id } = addElementToHtml(html, {
      type: "text",
      name: "New Text",
      content: "Hello!",
      startTime: 1,
      duration: 3,
      zIndex: 1,
    });

    expect(id).toBeDefined();
    expect(updated).toContain(`id="${id}"`);
    expect(updated).toContain('data-start="1"');
    expect(updated).toContain('data-end="4"');
    expect(updated).toContain("Hello!");
  });

  it("adds a video element", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div id="stage">
    <div id="stage-zoom-container"></div>
  </div>
</body></html>`;

    const { html: updated, id } = addElementToHtml(html, {
      type: "video",
      name: "My Video",
      src: "video.mp4",
      startTime: 0,
      duration: 10,
      zIndex: 0,
    });

    expect(updated).toContain(`id="${id}"`);
    expect(updated).toContain("video.mp4");
  });
});

describe("removeElementFromHtml", () => {
  it("removes an element by id", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div id="stage">
    <div id="el1" data-start="0" data-end="5"><div>Hello</div></div>
    <div id="el2" data-start="1" data-end="6"><div>World</div></div>
  </div>
</body></html>`;

    const updated = removeElementFromHtml(html, "el1");

    expect(updated).not.toContain('id="el1"');
    expect(updated).toContain('id="el2"');
  });
});

describe("validateCompositionHtml", () => {
  it("returns valid for a well-formed composition", () => {
    const html = `<!DOCTYPE html>
<html data-composition-id="comp-1" data-composition-duration="10">
<body>
  <div id="stage"></div>
</body>
</html>`;

    const result = validateCompositionHtml(html);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports error for missing composition-id", () => {
    const html = `<!DOCTYPE html>
<html data-composition-duration="10">
<body>
  <div id="stage"></div>
</body>
</html>`;

    const result = validateCompositionHtml(html);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing data-composition-id attribute on <html> element");
  });

  it("reports error for missing composition-duration", () => {
    const html = `<!DOCTYPE html>
<html data-composition-id="comp-1">
<body>
  <div id="stage"></div>
</body>
</html>`;

    const result = validateCompositionHtml(html);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing data-composition-duration attribute on <html> element");
  });

  it("reports error for missing #stage", () => {
    const html = `<!DOCTYPE html>
<html data-composition-id="comp-1" data-composition-duration="10">
<body></body>
</html>`;

    const result = validateCompositionHtml(html);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing #stage element");
  });

  it("reports error for inline event handlers", () => {
    const html = `<!DOCTYPE html>
<html data-composition-id="comp-1" data-composition-duration="10">
<body>
  <div id="stage" onclick="alert('hi')"></div>
</body>
</html>`;

    const result = validateCompositionHtml(html);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Inline event handlers (onclick, onload, etc.) not allowed");
  });
});

describe("extractCompositionMetadata", () => {
  it("extracts composition id and duration", () => {
    const html = `<!DOCTYPE html>
<html data-composition-id="comp-abc" data-composition-duration="15.5">
<body></body>
</html>`;

    const meta = extractCompositionMetadata(html);
    expect(meta.compositionId).toBe("comp-abc");
    expect(meta.compositionDuration).toBe(15.5);
  });

  it("returns null for missing metadata", () => {
    const html = `<!DOCTYPE html><html><body></body></html>`;

    const meta = extractCompositionMetadata(html);
    expect(meta.compositionId).toBeNull();
    expect(meta.compositionDuration).toBeNull();
  });

  it("extracts composition variables", () => {
    const variables = JSON.stringify([
      { id: "title", type: "string", label: "Title", default: "Hello" },
      { id: "count", type: "number", label: "Count", default: 5 },
    ]);
    const html = `<!DOCTYPE html>
<html data-composition-id="comp-1" data-composition-duration="10" data-composition-variables='${variables}'>
<body></body>
</html>`;

    const meta = extractCompositionMetadata(html);
    expect(meta.variables).toHaveLength(2);
    expect(meta.variables[0].id).toBe("title");
    expect(meta.variables[0].type).toBe("string");
    expect(meta.variables[1].id).toBe("count");
    expect(meta.variables[1].type).toBe("number");
  });
});
