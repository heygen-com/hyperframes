import { describe, expect, it } from "vitest";
import { audioRelPathForSrc, beatFilePathForSrc, findMusicAudioSrc } from "./beatFile";

describe("beat file source paths", () => {
  it.each([
    ["assets/100% beat.wav?v=1#listen", "assets/100% beat.wav"],
    ["assets/100%20beat%.wav?v=1#listen", "assets/100 beat%.wav"],
    ["https://example.test/assets/100%20beat%.wav?v=1", "assets/100 beat%.wav"],
    ["/api/projects/demo/preview/assets/100%20beat%.wav?v=1", "assets/100 beat%.wav"],
    ["/api/projects/demo/preview/comp/assets/100%20beat%.wav#listen", "assets/100 beat%.wav"],
  ])("resolves filename punctuation in %s", (src, path) => {
    expect(audioRelPathForSrc(src)).toBe(path);
    expect(beatFilePathForSrc(src)).toBe(`beats/${path}.json`);
  });

  it.each([
    ["assets/bed.wav?cache=1", "assets/bed.wav"],
    ["audio/bed.wav", "audio/bed.wav"],
    ["assets/a%2520%3F%23.wav?cache=1#listen", "assets/a%20?#.wav"],
    ["/api/projects/demo/preview/comp/assets/a%2520%3F%23.wav?cache=1", "assets/a%20?#.wav"],
    ["assets/100% beat.wav", "assets/100% beat.wav"],
  ])("preserves the source identity of %s", (src, path) => {
    expect(audioRelPathForSrc(src)).toBe(path);
    expect(beatFilePathForSrc(src)).toBe(`beats/${path}.json`);
  });

  it.each([null, undefined, "", "blob:temporary", "data:audio/wav;base64,AAAA"])(
    "does not persist a beat path for %s",
    (src) => {
      expect(audioRelPathForSrc(src)).toBeNull();
      expect(beatFilePathForSrc(src)).toBeNull();
    },
  );
});

describe("findMusicAudioSrc", () => {
  it("finds a video with sound tagged as music", () => {
    const html = `<video id="clip" src="band.mp4" data-has-audio="true" data-timeline-role="music"></video>`;
    expect(findMusicAudioSrc(html)).toBe("band.mp4");
  });

  it("finds an audible video by a music id", () => {
    expect(findMusicAudioSrc(`<video id="soundtrack" src="s.mp4" data-has-audio="true">`)).toBe(
      "s.mp4",
    );
  });

  it("skips a muted video and one without declared sound", () => {
    const html = [
      `<video id="music" src="muted.mp4" data-has-audio="true" muted>`,
      `<video id="bgm" src="undeclared.mp4">`,
      `<audio id="music-bed" src="bed.mp3">`,
    ].join("");
    expect(findMusicAudioSrc(html)).toBe("bed.mp3");
  });

  it("keeps document order across audio and video", () => {
    const html = `<audio id="music" src="first.mp3"></audio><video id="bgm" src="v.mp4" data-has-audio="true">`;
    expect(findMusicAudioSrc(html)).toBe("first.mp3");
  });

  it.each([
    ['<audio id="music" src="assets/don\'t-stop.wav">', "assets/don't-stop.wav"],
    ["<audio id='music' src='assets/say\"yes.wav'>", 'assets/say"yes.wav'],
    ['<audio id="music" src="assets/a>b.wav">', "assets/a>b.wav"],
    ['<audio id="music" src="assets/a&amp;b.wav">', "assets/a&b.wav"],
    ['<audio id="music" src="assets/don&#39;t-stop.wav">', "assets/don't-stop.wav"],
    ["<AUDIO ID=music SRC=assets/bed.wav>", "assets/bed.wav"],
  ])("reads the authored music source in %s", (html, src) => {
    expect(findMusicAudioSrc(html)).toBe(src);
  });

  it.each([
    '<audio data-id="music" src="wrong.wav">',
    '<audio id="music" data-src="wrong.wav">',
    '<audio title="id=\'music\'" src="wrong.wav">',
    '<!-- <audio id="music" src="wrong.wav"> -->',
    '<script>const markup = `<audio id="music" src="wrong.wav">`;</script>',
    '<style>.example::after { content: \'<audio id="music" src="wrong.wav">\'; }</style>',
  ])("skips non-music markup in %s", (prefix) => {
    expect(findMusicAudioSrc(`${prefix}<audio id="music" src="right.wav">`)).toBe("right.wav");
  });

  it("recognizes decoded music roles and sounding-video attributes", () => {
    expect(
      findMusicAudioSrc(
        '<video src="bed.mp4" data-has-audio="tr&#117;e" data-timeline-role="mus&#105;c">',
      ),
    ).toBe("bed.mp4");
  });

  it.each(['muted="false"', "MUTED", "muted=''"])(
    "skips a music video with the boolean attribute %s",
    (muted) => {
      expect(
        findMusicAudioSrc(
          `<video id="music" src="muted.mp4" data-has-audio="true" ${muted}><audio id="bgm" src="right.wav">`,
        ),
      ).toBe("right.wav");
    },
  );

  it("does not treat text inside a quoted attribute as muted", () => {
    expect(
      findMusicAudioSrc(
        '<video id="music" src="bed.mp4" data-has-audio="true" title="muted > example">',
      ),
    ).toBe("bed.mp4");
  });

  it("keeps the first duplicate attribute, like the browser", () => {
    const prefix = '<audio id="speech" id="music" src="wrong.wav">';
    expect(findMusicAudioSrc(`${prefix}<audio id="music" src="right.wav" src="wrong.wav">`)).toBe(
      "right.wav",
    );
  });

  it("keeps an explicit non-music role ahead of an id fallback", () => {
    expect(
      findMusicAudioSrc(
        '<audio id="music" data-timeline-role="voiceover" src="speech.wav"><audio id="bgm" src="right.wav">',
      ),
    ).toBe("right.wav");
  });
});
