/**
 * Extract computed design styles from key DOM elements.
 *
 * Targets ~50 elements (headings, body text, buttons, cards, nav) and extracts
 * only design-relevant CSS properties. Output is a compact, pre-clustered
 * design system summary — not raw computed styles per element.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import type { Page } from "puppeteer-core";
import type { DesignStyles } from "./types.js";

const EXTRACT_DESIGN_STYLES_SCRIPT = `(() => {
  var isVisible = (el) => {
    var s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" && el.getBoundingClientRect().height > 0;
  };

  function rgbToHex(color) {
    if (!color) return "";
    if (color.startsWith('#')) return color.toUpperCase();
    var m = color.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*([\\d.]+))?/);
    if (!m) return color;
    // fully-transparent fill (rgba(...,0)) → sentinel, NOT #000000 — otherwise a transparent
    // chip/tab/stat ground reads as solid black on a light-ground site.
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return "transparent";
    return '#' + ((1<<24) + (parseInt(m[1])<<16) + (parseInt(m[2])<<8) + parseInt(m[3])).toString(16).slice(1).toUpperCase();
  }

  function cleanFont(f) {
    return f.split(",")[0].replace(/['"]/g, "").trim();
  }

  function getStyles(el) {
    var s = getComputedStyle(el);
    return {
      fontFamily: cleanFont(s.fontFamily),
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      color: rgbToHex(s.color),
      background: rgbToHex(s.backgroundColor),
      padding: s.padding,
      borderRadius: s.borderRadius,
      border: s.border,
      boxShadow: s.boxShadow === "none" ? "none" : s.boxShadow,
      height: s.height
    };
  }

  // ── 1. Typography hierarchy ──
  // Sample each text role and deduplicate by fontSize
  var typographyMap = {};
  var roleSelectors = [
    { role: "display", sel: "h1", max: 3 },
    { role: "heading-2", sel: "h2", max: 5 },
    { role: "heading-3", sel: "h3", max: 5 },
    { role: "heading-4", sel: "h4", max: 3 },
    { role: "body", sel: "p", max: 10 },
    { role: "body-small", sel: "figcaption, .caption, [class*='caption'], [class*='subtitle'], small", max: 5 },
    { role: "label", sel: "label, [class*='label'], [class*='tag'], [class*='badge']", max: 5 },
    { role: "link", sel: "a:not([class*='btn']):not([class*='button']):not([role='button'])", max: 5 },
    { role: "code", sel: "code, pre, [class*='mono']", max: 3 }
  ];

  for (var ri = 0; ri < roleSelectors.length; ri++) {
    var spec = roleSelectors[ri];
    var els = Array.from(document.querySelectorAll(spec.sel)).slice(0, spec.max);
    for (var ei = 0; ei < els.length; ei++) {
      if (!isVisible(els[ei])) continue;
      var s = getStyles(els[ei]);
      var key = s.fontSize + "|" + s.fontWeight + "|" + s.fontFamily;
      if (!typographyMap[key]) {
        var text = (els[ei].textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60);
        typographyMap[key] = {
          role: spec.role,
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          lineHeight: s.lineHeight,
          letterSpacing: s.letterSpacing,
          color: s.color,
          sampleText: text
        };
      }
    }
  }

  // Sort by font size descending
  var typography = Object.values(typographyMap);
  typography.sort(function(a, b) {
    return parseFloat(b.fontSize) - parseFloat(a.fontSize);
  });

  // Deduplicate roles — keep only the first (largest) for each role prefix
  var seenRoles = {};
  var uniqueTypo = [];
  for (var ti = 0; ti < typography.length; ti++) {
    var baseRole = typography[ti].role.replace(/-\\d+$/, "");
    if (!seenRoles[baseRole]) {
      seenRoles[baseRole] = true;
      typography[ti].role = baseRole;
      uniqueTypo.push(typography[ti]);
    } else if (baseRole === "heading") {
      // Keep multiple heading levels
      uniqueTypo.push(typography[ti]);
    }
  }

  // ── 2. Buttons ──
  var buttonEls = Array.from(document.querySelectorAll(
    'button, a[class*="btn"], a[class*="button"], a[role="button"], ' +
    '[class*="btn-"], [class*="button-"], [class*="cta"]'
  )).filter(function(el) {
    return isVisible(el) && !el.closest('nav, [role="navigation"]');
  }).slice(0, 10);

  var buttonMap = {};
  for (var bi = 0; bi < buttonEls.length; bi++) {
    var bs = getStyles(buttonEls[bi]);
    // Deduplicate by visual appearance
    var bKey = bs.background + "|" + bs.borderRadius + "|" + bs.border;
    if (!buttonMap[bKey]) {
      var btnText = (buttonEls[bi].textContent || "").trim().slice(0, 40);
      buttonMap[bKey] = {
        label: btnText || "button",
        background: bs.background,
        color: bs.color,
        padding: bs.padding,
        borderRadius: bs.borderRadius,
        border: bs.border,
        boxShadow: bs.boxShadow,
        fontSize: bs.fontSize,
        fontWeight: bs.fontWeight,
        height: bs.height
      };
    }
  }
  var buttons = Object.values(buttonMap).slice(0, 4);

  // ── 3. Cards / containers ──
  var cardEls = Array.from(document.querySelectorAll(
    '[class*="card"], [class*="Card"], [class*="tile"], [class*="Tile"], ' +
    '[class*="panel"], [class*="Panel"], [class*="feature"], ' +
    'article, [class*="box"]:not(select):not(input)'
  )).filter(function(el) {
    var rect = el.getBoundingClientRect();
    return isVisible(el) && rect.width > 100 && rect.height > 80;
  }).slice(0, 10);

  var cardMap = {};
  for (var ci = 0; ci < cardEls.length; ci++) {
    var cs = getStyles(cardEls[ci]);
    var cKey = cs.background + "|" + cs.borderRadius + "|" + cs.border;
    if (!cardMap[cKey]) {
      cardMap[cKey] = {
        label: "card",
        background: cs.background,
        color: cs.color,
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        border: cs.border,
        boxShadow: cs.boxShadow,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        height: cs.height
      };
    }
  }
  var cards = Object.values(cardMap).slice(0, 4);

  // ── 4. Navigation ──
  var navEl = document.querySelector('nav, header, [role="navigation"], [class*="navbar"], [class*="header"]');
  var nav = null;
  if (navEl && isVisible(navEl)) {
    var ns = getStyles(navEl);
    nav = {
      label: "navigation",
      background: ns.background,
      color: ns.color,
      padding: ns.padding,
      borderRadius: ns.borderRadius,
      border: ns.border,
      boxShadow: ns.boxShadow,
      fontSize: ns.fontSize,
      fontWeight: ns.fontWeight,
      height: ns.height
    };
  }

  // ── 4b. Chips / pills / badges / tags ──
  // selector by class-substring, PLUS a shape fallback (small + fully-rounded + short text) so
  // hashed/utility class names (Tailwind, CSS-modules) still get caught.
  var chipEls = Array.from(document.querySelectorAll(
    '[class*="pill"], [class*="Pill"], [class*="badge"], [class*="Badge"], ' +
    '[class*="chip"], [class*="Chip"], [class*="tag"], [class*="Tag"]'
  )).filter(function(el) {
    if (!isVisible(el) || el.closest('nav, [role="navigation"]')) return false;
    var r = el.getBoundingClientRect();
    var txt = (el.textContent || "").trim();
    return r.height > 0 && r.height <= 60 && r.width <= 360 && txt.length > 0 && txt.length <= 40;
  });
  var shapeChips = Array.from(document.querySelectorAll('span, div, li, a')).slice(0, 500).filter(function(el) {
    if (!isVisible(el) || el.closest('nav, [role="navigation"]')) return false;
    var st = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var rad = parseFloat(st.borderRadius) || 0;
    var txt = (el.textContent || "").trim();
    var hasSkin = (st.backgroundColor && st.backgroundColor !== "rgba(0, 0, 0, 0)" && st.backgroundColor !== "transparent") || (parseFloat(st.borderTopWidth) || 0) > 0;
    return hasSkin && r.height > 0 && r.height <= 44 && r.width <= 260 && rad >= (r.height / 2) - 1 && txt.length > 0 && txt.length <= 24 && el.children.length <= 1;
  });
  var allChips = chipEls.concat(shapeChips);
  var chipMap = {};
  for (var chi = 0; chi < allChips.length; chi++) {
    var chs = getStyles(allChips[chi]);
    var chKey = chs.background + "|" + chs.borderRadius + "|" + chs.border;
    if (!chipMap[chKey]) {
      chipMap[chKey] = {
        label: (allChips[chi].textContent || "").trim().slice(0, 24) || "chip",
        background: chs.background, color: chs.color, padding: chs.padding, borderRadius: chs.borderRadius,
        border: chs.border, boxShadow: chs.boxShadow, fontSize: chs.fontSize, fontWeight: chs.fontWeight, height: chs.height
      };
    }
  }
  var chips = Object.values(chipMap).slice(0, 4);

  // ── 4c. Stat / metric cells (a big numeral + a small label) ──
  var statEls = Array.from(document.querySelectorAll(
    '[class*="stat"], [class*="Stat"], [class*="metric"], [class*="Metric"], ' +
    '[class*="kpi"], [class*="KPI"], [class*="figure"], [class*="Figure"]'
  )).filter(function(el) {
    if (!isVisible(el)) return false;
    var r = el.getBoundingClientRect();
    return r.height > 0 && r.height <= 400 && r.width <= 600;
  }).slice(0, 14);
  function biggestFontChild(el) {
    var best = 0, bestEl = null, kids = el.querySelectorAll("*");
    for (var i = 0; i < kids.length; i++) {
      if (!isVisible(kids[i])) continue;
      var fz = parseFloat(getComputedStyle(kids[i]).fontSize) || 0;
      if (fz > best) { best = fz; bestEl = kids[i]; }
    }
    return bestEl;
  }
  var statMap = {};
  for (var sti = 0; sti < statEls.length; sti++) {
    var numEl = biggestFontChild(statEls[sti]) || statEls[sti];
    var numFz = parseFloat(getComputedStyle(numEl).fontSize) || 0;
    if (numFz < 28) continue; // needs a genuinely large numeral to count as a stat cell
    var cst = getStyles(statEls[sti]);
    var nst = getStyles(numEl);
    var stKey = Math.round(numFz) + "|" + cst.background;
    if (!statMap[stKey]) {
      statMap[stKey] = {
        background: cst.background, borderRadius: cst.borderRadius, border: cst.border, boxShadow: cst.boxShadow,
        numberFontSize: nst.fontSize, numberFontWeight: nst.fontWeight, numberColor: nst.color
      };
    }
  }
  var statCells = Object.values(statMap).slice(0, 3);

  // ── 4d. Tabs ──
  var tabEls = Array.from(document.querySelectorAll(
    '[role="tab"], [class*="tab"]:not([class*="table"]):not([class*="Table"])'
  )).filter(function(el) {
    if (!isVisible(el)) return false;
    var r = el.getBoundingClientRect();
    var txt = (el.textContent || "").trim();
    return r.height > 0 && r.height <= 64 && txt.length > 0 && txt.length <= 30;
  }).slice(0, 12);
  var tabMap = {};
  for (var tbi = 0; tbi < tabEls.length; tbi++) {
    var tst = getStyles(tabEls[tbi]);
    var tKey = tst.background + "|" + tst.color + "|" + tst.border;
    if (!tabMap[tKey]) {
      tabMap[tKey] = {
        label: (tabEls[tbi].textContent || "").trim().slice(0, 24) || "tab",
        background: tst.background, color: tst.color, padding: tst.padding, borderRadius: tst.borderRadius,
        border: tst.border, boxShadow: tst.boxShadow, fontSize: tst.fontSize, fontWeight: tst.fontWeight, height: tst.height
      };
    }
  }
  var tabs = Object.values(tabMap).slice(0, 4);

  // ── 5. Spacing scale ──
  // Collect padding and margin values from visible elements
  var spacingCounts = {};
  var spacingSamples = Array.from(document.querySelectorAll(
    "section, div, article, main, aside, header, footer, nav, " +
    "button, a, p, h1, h2, h3, h4, li, ul, ol"
  )).slice(0, 200);

  for (var si = 0; si < spacingSamples.length; si++) {
    if (!isVisible(spacingSamples[si])) continue;
    var ss = getComputedStyle(spacingSamples[si]);
    var props = [ss.paddingTop, ss.paddingRight, ss.paddingBottom, ss.paddingLeft,
                 ss.marginTop, ss.marginRight, ss.marginBottom, ss.marginLeft,
                 ss.gap, ss.rowGap, ss.columnGap];
    for (var pi = 0; pi < props.length; pi++) {
      var val = parseFloat(props[pi]);
      if (val > 0 && val <= 200) {
        var rounded = Math.round(val);
        spacingCounts[rounded] = (spacingCounts[rounded] || 0) + 1;
      }
    }
  }

  // Find the most common spacing values (at least 3 occurrences)
  var spacingEntries = Object.entries(spacingCounts)
    .filter(function(e) { return e[1] >= 3; })
    .sort(function(a, b) { return b[1] - a[1]; });
  var observedSpacing = spacingEntries.map(function(e) { return parseInt(e[0]); }).sort(function(a,b) { return a - b; });

  // Detect base unit — GCD of the top spacing values, clamped to 4 or 8
  var baseUnit = 8;
  if (observedSpacing.length >= 3) {
    var divisible4 = observedSpacing.filter(function(v) { return v % 4 === 0; }).length;
    var divisible8 = observedSpacing.filter(function(v) { return v % 8 === 0; }).length;
    baseUnit = (divisible4 > divisible8 * 1.5) ? 4 : 8;
  }

  // ── 6. Border radius scale ──
  var radiusCounts = {};
  var radiusSamples = Array.from(document.querySelectorAll(
    "button, a, [class*='card'], [class*='btn'], input, select, textarea, " +
    "[class*='badge'], [class*='tag'], [class*='chip'], img, video"
  )).slice(0, 100);

  for (var rsi = 0; rsi < radiusSamples.length; rsi++) {
    if (!isVisible(radiusSamples[rsi])) continue;
    var br = getComputedStyle(radiusSamples[rsi]).borderRadius;
    if (br && br !== "0px") {
      radiusCounts[br] = (radiusCounts[br] || 0) + 1;
    }
  }

  var radius = Object.entries(radiusCounts)
    .filter(function(e) { return e[1] >= 2; })
    .sort(function(a, b) { return parseFloat(a[0]) - parseFloat(b[0]); })
    .map(function(e) { return e[0]; });

  // ── 7. Box shadows ──
  var shadowCounts = {};
  var shadowSamples = Array.from(document.querySelectorAll(
    "[class*='card'], [class*='Card'], button, [class*='btn'], " +
    "[class*='dropdown'], [class*='modal'], [class*='popover'], " +
    "nav, header, [class*='panel'], article"
  )).slice(0, 100);

  for (var shi = 0; shi < shadowSamples.length; shi++) {
    if (!isVisible(shadowSamples[shi])) continue;
    var shVal = getComputedStyle(shadowSamples[shi]).boxShadow;
    if (shVal && shVal !== "none") {
      shadowCounts[shVal] = (shadowCounts[shVal] || 0) + 1;
    }
  }

  var shadows = Object.entries(shadowCounts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5)
    .map(function(e) { return { value: e[0], count: e[1] }; });

  return {
    typography: uniqueTypo,
    spacing: { observed: observedSpacing.slice(0, 15), baseUnit: baseUnit },
    radius: radius,
    shadows: shadows,
    buttons: buttons,
    cards: cards,
    nav: nav,
    chips: chips,
    statCells: statCells,
    tabs: tabs
  };
})()`;

export async function extractDesignStyles(page: Page): Promise<DesignStyles> {
  return page.evaluate(EXTRACT_DESIGN_STYLES_SCRIPT) as Promise<DesignStyles>;
}
