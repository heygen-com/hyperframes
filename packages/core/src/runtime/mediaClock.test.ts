import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { mediaElementTime } from "./mediaClock";

// Chrome stores currentTime as whole microseconds, truncated (WebMediaPlayerImpl::Seek -> base::Seconds), and its frame
// timestamps are off by up to 2 us (Chrome 152, every frame of 600 at 30 and 29.97 fps), so a seek to an exact frame
// instant can show the previous frame.
const storedMicroseconds = (seconds: number) => Math.trunc(seconds * 1e6);
const CHROME_FRAME_TIMESTAMP_ROUNDING_US = 2;

describe("mediaElementTime", () => {
  it("lands inside the frame that starts at the instant, at every common frame rate", () => {
    const missed: string[] = [];
    for (const fps of [24, 25, 30, 50, 60, 24000 / 1001, 30000 / 1001, 60000 / 1001]) {
      for (let frame = 0; frame < 20_000; frame++) {
        const stored = storedMicroseconds(mediaElementTime(frame / fps));
        const inside =
          stored >= (frame / fps) * 1e6 + CHROME_FRAME_TIMESTAMP_ROUNDING_US &&
          stored < ((frame + 1) / fps) * 1e6 - CHROME_FRAME_TIMESTAMP_ROUNDING_US;
        if (!inside) missed.push(`${fps} fps frame ${frame}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it("lands on the frame when the start and in-point were written with six decimals", () => {
    // Frame 89 at 30 fps written as 2.966667 (a third of a microsecond late) and source frame 1165 as
    // 38.833333 (a third early): at output frame 90 the clip shows source frame 1166.
    const sourceTime = 38.833333 + (90 / 30 - 2.966667);
    expect(storedMicroseconds(mediaElementTime(sourceTime))).toBeGreaterThanOrEqual(
      (1166 / 30) * 1e6 + CHROME_FRAME_TIMESTAMP_ROUNDING_US,
    );
  });

  it("is what a raw seek to an exact frame instant is not", () => {
    // 2/30 s is stored as 66666 us; the frame starts at 66667 us.
    expect(storedMicroseconds(2 / 30)).toBe(66666);
    expect(storedMicroseconds(mediaElementTime(2 / 30))).toBeGreaterThan(
      66667 + CHROME_FRAME_TIMESTAMP_ROUNDING_US,
    );
  });
});

describe("media currentTime writers", () => {
  const packages = join(__dirname, "../../..");
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  it("seek media elements through mediaElementTime", () => {
    const raw = [
      join(packages, "core/src/runtime"),
      join(packages, "core/src/generators"),
      join(packages, "player/src"),
      join(packages, "parsers/src"),
    ]
      .flatMap(sources)
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, i) => ({ line: line.trim(), at: `${relative(packages, file)}:${i + 1}` })),
      )
      // Runtime state and Web Animations (milliseconds) also have a currentTime; a seek to 0 cannot land early.
      .filter(({ line }) => /\.currentTime\s*=(?!=)/.test(line))
      .filter(({ line }) => !/^(state|animation)\.currentTime\b/.test(line))
      // Generated inline scripts add the lead as text: core's constant, or the one core hands the parsers serializer.
      .filter(
        ({ line }) =>
          !/\.currentTime\s*=\s*(0;|mediaElementTime\(|mediaTime \+ \$\{(MEDIA_ELEMENT_LEAD_SECONDS|Number\(options\.mediaElementLeadSeconds \?\? 0\))\})/.test(
            line,
          ),
      )
      .map(({ at, line }) => `${at} ${line}`);
    expect(raw).toEqual([]);
  });
});
