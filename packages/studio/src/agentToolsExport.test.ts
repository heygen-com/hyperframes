import { expect, it } from "vitest";
import { buildStudioTools, collectStudioLookScene, type StudioAgentToolsDeps } from "@hyperframes/studio";

it("exports Studio's agent tools so a host can run them on its own edit session", () => {
  const tools = buildStudioTools({ current: {} as StudioAgentToolsDeps });
  expect(tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["studio_look", "studio_inspect", "studio_select", "studio_seek"]),
  );
  expect(typeof collectStudioLookScene).toBe("function");
});
