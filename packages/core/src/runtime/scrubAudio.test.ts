import { afterEach, describe, expect, it, vi } from "vitest";
import { createScrubAudio } from "./scrubAudio";

function tracks(html: string): HTMLAudioElement[] {
  document.body.innerHTML = html;
  const all = Array.from(document.querySelectorAll("audio"));
  for (const audio of all) Object.assign(audio, { play: vi.fn(async () => {}), pause: vi.fn() });
  return all;
}

const lease = vi.fn();
const release = vi.fn();
const scrubber = createScrubAudio({ lease, release });

afterEach(() => {
  scrubber.stop();
  lease.mockClear();
  release.mockClear();
  document.body.innerHTML = "";
});

describe("createScrubAudio", () => {
  it("plays the music row's track at the scrub volume", () => {
    const [music] = tracks('<audio id="music"></audio>');

    scrubber.scrub({ id: "music" }, 0.5, 0.4);

    expect(music!.play).toHaveBeenCalled();
    expect(music!.volume).toBeCloseTo(0.1);
  });

  it("plays the track named by the music row, not the first audio in the document", () => {
    const [voiceover, music] = tracks(
      '<audio id="voiceover"></audio><audio id="music-bed"></audio>',
    );

    scrubber.scrub({ id: "music-bed" }, 0.5, 1);

    expect(music!.play).toHaveBeenCalled();
    expect(voiceover!.play).not.toHaveBeenCalled();
  });

  it("plays the music row's own track when a sub-composition repeats its id", () => {
    const [inner, root] = tracks(
      '<div data-composition-id="strip" data-composition-src="compositions/strip.html" data-composition-file="compositions/strip.html"><audio id="music"></audio></div>' +
        '<audio id="music" class="root"></audio>',
    );

    scrubber.scrub({ id: "music" }, 0.5, 1);

    expect(root!.play).toHaveBeenCalled();
    expect(inner!.play).not.toHaveBeenCalled();
  });

  // An edit to a sub-composition rebuilds its media, so the row can name a track that is briefly not in the preview.
  it("plays nothing when the music row's own track is not in the preview", () => {
    const [voiceover] = tracks('<audio id="voiceover"></audio>');

    scrubber.scrub({ id: "music-bed" }, 0.5, 1);

    expect(voiceover!.play).not.toHaveBeenCalled();
    expect(voiceover!.volume).toBe(1);
  });

  it("plays the track marked as the music when the row's own id is gone", () => {
    const [voiceover, bed] = tracks(
      '<audio id="voiceover"></audio><audio id="bed" data-timeline-role="music"></audio>',
    );

    scrubber.scrub({ id: "music-bed" }, 0.5, 1);

    expect(bed!.play).toHaveBeenCalled();
    expect(voiceover!.play).not.toHaveBeenCalled();
  });

  it("borrows the track for the audition and gives it back, muted state and volume included", () => {
    const [music] = tracks('<audio id="music" muted></audio>');
    music!.muted = true;
    music!.volume = 0.8;

    scrubber.scrub({ id: "music" }, 0.5, 1);

    expect(lease).toHaveBeenCalledWith(music);
    expect(music!.muted).toBe(false);

    scrubber.scrub(null, null, 0);

    expect(release).toHaveBeenCalledWith(music);
    expect(music!.pause).toHaveBeenCalled();
    expect(music!.muted).toBe(true);
    expect(music!.volume).toBe(0.8);
  });

  it("stops by itself shortly after the last scrub", () => {
    vi.useFakeTimers();
    try {
      const [music] = tracks('<audio id="music"></audio>');
      scrubber.scrub({ id: "music" }, 0.5, 1);

      vi.advanceTimersByTime(140);

      expect(release).toHaveBeenCalledWith(music);
    } finally {
      vi.useRealTimers();
    }
  });
});
