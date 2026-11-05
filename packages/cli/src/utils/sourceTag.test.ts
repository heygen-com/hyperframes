import { describe, expect, it } from "vitest";
import { cliSourced } from "./sourceTag.js";

describe("cliSourced", () => {
  it("tags our sites with utm_source=cli, keeping the query and fragment", () => {
    expect(cliSourced("https://hyperframes.heygen.com/prompting/overview")).toBe(
      "https://hyperframes.heygen.com/prompting/overview?utm_source=cli",
    );
    expect(cliSourced("https://hyperframes.studio/p/abc?claim_token=t#top")).toBe(
      "https://hyperframes.studio/p/abc?claim_token=t&utm_source=cli#top",
    );
    expect(cliSourced("https://app.heygen.com/settings/api")).toBe(
      "https://app.heygen.com/settings/api?utm_source=cli",
    );
  });

  it("leaves other hosts, look-alikes, an existing source and non-URLs alone", () => {
    for (const url of [
      "https://github.com/heygen-com/hyperframes",
      "https://hyperframes.app/",
      "https://notheygen.com/",
      "https://hyperframes.studio/?utm_source=github",
      "not a url",
    ])
      expect(cliSourced(url)).toBe(url);
  });
});
