import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discordPayload, parseLatestDigest, slackPayload } from "./changelog-announce.ts";

const PAGE = `---
title: "Weekly updates"
---

{/* marker */}

<Update
  label="Week of November 2, 2026"
  description="Weekly digest"
  tags={["Weekly update", "Highlights"]}
>

<Frame>
  <DocsVideo title="v" src="https://static.heygen.ai/x/week.mp4" />
</Frame>

**20 releases this week (v0.9.6 to v0.9.26).** The five you'll notice are below.

## The 5 you'll feel

**1. Preview = render.** Same film at any worker count. [#7410](https://github.com/x/pull/7410)

**2. Motion blur uses the filter tier by default.** Detail.

</Update>

<Update label="Week of October 26, 2026" description="older" tags={[]}>
**1. Old.** nope
</Update>
`;

describe("changelog announce", () => {
  it("should read the newest entry only", () => {
    const d = parseLatestDigest(PAGE);
    assert.equal(d.label, "Week of November 2, 2026");
    assert.equal(d.video, "https://static.heygen.ai/x/week.mp4");
    assert.equal(
      d.summary,
      "20 releases this week (v0.9.6 to v0.9.26). The five you'll notice are below.",
    );
    assert.deepEqual(d.highlights, [
      "Preview = render",
      "Motion blur uses the filter tier by default",
    ]);
  });

  it("should fall back to section headings for older digests", () => {
    const old = PAGE.replace(/\*\*\d\. /g, "**").replace(
      "## The 5 you'll feel",
      "## Renders\n\ntext\n\n## Cloud",
    );
    assert.deepEqual(parseLatestDigest(old).highlights.slice(0, 2), ["Renders", "Cloud"]);
  });

  it("should put the video link where each app plays it", () => {
    const d = parseLatestDigest(PAGE);
    assert.match(JSON.stringify(slackPayload(d)), /week\.mp4\|Watch the video/);
    assert.equal(discordPayload(d).content, "https://static.heygen.ai/x/week.mp4");
  });

  it("should throw when the page has no entry", () => {
    assert.throws(() => parseLatestDigest("# nothing"), /no <Update>/);
  });
});
