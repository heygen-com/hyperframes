// Browser-side WCAG contrast audit.
// Loaded as a raw string and injected via page.addScriptTag to avoid
// esbuild mangling (page.evaluate serializes functions; __name helpers break).
//
// NOTE: WCAG math (relLum, wcagRatio, parseColor, median) is duplicated in
// skills/hyperframes/scripts/contrast-report.mjs — keep in sync.

/* eslint-disable */
window.__contrastAudit = async function (imgBase64, time) {
  function relLum(r, g, b) {
    function ch(v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }

  function wcagRatio(r1, g1, b1, r2, g2, b2) {
    var l1 = relLum(r1, g1, b1),
      l2 = relLum(r2, g2, b2);
    var hi = l1 > l2 ? l1 : l2,
      lo = l1 > l2 ? l2 : l1;
    return (hi + 0.05) / (lo + 0.05);
  }

  function parseColor(c) {
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 1];
    var p = m[1].split(",").map(function (s) {
      return parseFloat(s.trim());
    });
    return [p[0], p[1], p[2], p[3] != null ? p[3] : 1];
  }

  function selectorOf(el) {
    if (el.id) return "#" + el.id;
    var cls = Array.from(el.classList).slice(0, 2).join(".");
    return cls ? el.tagName.toLowerCase() + "." + cls : el.tagName.toLowerCase();
  }

  function median(arr) {
    var s = arr.slice().sort(function (a, b) {
      return a - b;
    });
    return s[Math.floor(s.length / 2)];
  }

  // Decode screenshot into canvas pixel data
  var img = new Image();
  await new Promise(function (resolve) {
    img.onload = resolve;
    img.onerror = function () {
      resolve();
    };
    img.src = "data:image/png;base64," + imgBase64;
  });
  if (!img.naturalWidth) return [];
  var canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1920;
  canvas.height = img.naturalHeight || 1080;
  var ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0);
  var px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  var w = canvas.width;
  var h = canvas.height;

  // Walk DOM for text elements
  var out = [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  var node;
  while ((node = walker.nextNode())) {
    var el = node;

    // Must have a direct text node child
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      if (
        el.childNodes[i].nodeType === 3 &&
        (el.childNodes[i].textContent || "").trim().length > 0
      ) {
        hasText = true;
        break;
      }
    }
    if (!hasText) continue;

    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (parseFloat(cs.opacity) <= 0.01) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= w || rect.top >= h) continue;

    var fg = parseColor(cs.color);
    if (fg[3] <= 0.01) continue;

    // Sample 4px ring outside bbox for background color
    var rr = [],
      gg = [],
      bb = [];
    var x0 = Math.max(0, Math.floor(rect.x) - 4);
    var x1 = Math.min(w - 1, Math.ceil(rect.x + rect.width) + 4);
    var y0 = Math.max(0, Math.floor(rect.y) - 4);
    var y1 = Math.min(h - 1, Math.ceil(rect.y + rect.height) + 4);
    var sample = function (sx, sy) {
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;
      var idx = (sy * w + sx) * 4;
      rr.push(px[idx]);
      gg.push(px[idx + 1]);
      bb.push(px[idx + 2]);
    };
    for (var x = x0; x <= x1; x++) {
      sample(x, y0);
      sample(x, y1);
    }
    for (var y = y0; y <= y1; y++) {
      sample(x0, y);
      sample(x1, y);
    }

    if (rr.length === 0) continue;

    var bgR = median(rr),
      bgG = median(gg),
      bgB = median(bb);

    // Composite foreground alpha over measured background
    var compR = Math.round(fg[0] * fg[3] + bgR * (1 - fg[3]));
    var compG = Math.round(fg[1] * fg[3] + bgG * (1 - fg[3]));
    var compB = Math.round(fg[2] * fg[3] + bgB * (1 - fg[3]));

    var ratio = +wcagRatio(compR, compG, compB, bgR, bgG, bgB).toFixed(2);
    var fontSize = parseFloat(cs.fontSize);
    var fontWeight = Number(cs.fontWeight) || 400;
    var large = fontSize >= 24 || (fontSize >= 19 && fontWeight >= 700);

    out.push({
      time: time,
      selector: selectorOf(el),
      text: (el.textContent || "").trim().slice(0, 50),
      ratio: ratio,
      wcagAA: large ? ratio >= 3 : ratio >= 4.5,
      large: large,
      fg: "rgb(" + compR + "," + compG + "," + compB + ")",
      bg: "rgb(" + bgR + "," + bgG + "," + bgB + ")",
    });
  }
  return out;
};
