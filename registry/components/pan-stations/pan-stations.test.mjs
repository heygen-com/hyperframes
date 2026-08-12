import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./pan-stations.html", import.meta.url), "utf8");

test("each indexed pan stop stays centered after the mount resizes", () => {
  assert.match(source, /--ps-pan-index:\s*0/);
  assert.match(
    source,
    /transform:\s*translateX\(\s*calc\(\s*var\(--ps-pan-index\)\s*\*\s*-1\s*\*\s*\(var\(--ps-station-width\)\s*\+\s*var\(--ps-station-gap\)\)\s*\)\s*\)/,
  );
  assert.match(source, /"--ps-pan-index":\s*stationIndex\s*\+\s*1/);
  assert.doesNotMatch(source, /getBoundingClientRect\(\)/);

  const stationWidthMatch = source.match(/--ps-station-width:\s*([\d.]+)cqw/);
  const stationGapMatch = source.match(/--ps-station-gap:[^;]*,\s*([\d.]+)cqw\)/);
  const stripPaddingMatch = source.match(/padding:\s*0\s+([\d.]+)cqw/);
  const stationCountRangeMatch = source.match(
    /"id":\s*"stationCount"[^}]*"min":\s*(\d+)[^}]*"max":\s*(\d+)/,
  );
  assert.ok(stationWidthMatch && stationGapMatch && stripPaddingMatch && stationCountRangeMatch);

  const stationWidth = Number(stationWidthMatch[1]) / 100;
  const stationGap = Number(stationGapMatch[1]) / 100;
  const stripPadding = Number(stripPaddingMatch[1]) / 100;
  const minStationCount = Number(stationCountRangeMatch[1]);
  const maxStationCount = Number(stationCountRangeMatch[2]);

  for (const viewportWidth of [640, 1651, 1920]) {
    for (let stationCount = minStationCount; stationCount <= maxStationCount; stationCount += 1) {
      for (let stationIndex = 0; stationIndex < stationCount; stationIndex += 1) {
        const stationCenter =
          viewportWidth * stripPadding +
          stationIndex * viewportWidth * (stationWidth + stationGap) +
          viewportWidth * stationWidth * 0.5 -
          stationIndex * viewportWidth * (stationWidth + stationGap);

        assert.ok(Math.abs(stationCenter - viewportWidth / 2) < 1e-9);
      }
    }
  }
});
