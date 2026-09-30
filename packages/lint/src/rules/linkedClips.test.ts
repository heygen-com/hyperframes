import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

const VIDEO =
  'id="talk" src="talk.mp4" muted data-link="lk-1" data-start="2" data-duration="6" data-media-start="1" data-track-index="0"';
const AUDIO =
  'id="talk-audio" src="talk.mp4" data-link="lk-1" data-start="2" data-duration="6" data-media-start="1" data-track-index="2"';

function composition(body: string): string {
  return `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    ${body}
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
}

async function linkFindings(body: string) {
  const result = await lintHyperframeHtml(composition(body));
  return result.findings.filter((f) => f.code.startsWith("linked_clip"));
}

describe("linked clip rules", () => {
  it("an in-sync pair is clean", async () => {
    expect(await linkFindings(`<video ${VIDEO}></video><audio ${AUDIO}></audio>`)).toEqual([]);
  });

  it("absent media-start and playback-rate equal their defaults", async () => {
    const video = VIDEO.replace(' data-media-start="1"', ' data-media-start="0"');
    const audio = AUDIO.replace(' data-media-start="1"', ' data-playback-rate="1"');
    expect(await linkFindings(`<video ${video}></video><audio ${audio}></audio>`)).toEqual([]);
  });

  it.each([
    ['data-start="2"', 'data-start="2.5"', "start"],
    ['data-duration="6"', 'data-duration="5"', "duration"],
    ['data-media-start="1"', 'data-media-start="0"', "media-start"],
    ['data-media-start="1"', 'data-media-start="1" data-playback-rate="2"', "playback-rate"],
  ])("warns when %s drifts to %s", async (from, to, field) => {
    const findings = await linkFindings(
      `<video ${VIDEO}></video><audio ${AUDIO.replace(from, to)}></audio>`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("linked_clips_out_of_sync");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain(field);
    expect(findings[0]?.message).toContain("lk-1");
  });

  it("warns on a link id with one member", async () => {
    const findings = await linkFindings(`<video ${VIDEO}></video>`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("linked_clip_orphan");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.elementId).toBe("talk");
  });

  it("track index, volume and fades may differ freely", async () => {
    const audio = `${AUDIO} data-volume="0.5" data-fade-in="1"`;
    expect(await linkFindings(`<video ${VIDEO}></video><audio ${audio}></audio>`)).toEqual([]);
  });
});
