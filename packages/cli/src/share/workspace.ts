import type { ReviewClient } from "@hyperframes/share";

type Space = Awaited<ReturnType<ReviewClient["spaces"]>>[number];
export function namedWorkspace(space: Space) {
  return {
    id: space.space_id,
    name: space.name || (space.kind === "personal" ? "Personal workspace" : space.space_id),
  };
}
