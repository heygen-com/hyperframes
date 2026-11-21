import { expect, it, vi } from "vitest";
import { presentSpaces } from "./sharePresentation.js";
vi.mock("../share/auth.js", () => ({ shareSite: () => "https://hyperframes.dev" }));

it.each(["free", "subscribed", undefined] as const)(
  "preserves authoritative plan %s for the upgrade offer",
  (plan) => {
    const space = {
      space_id: "space",
      name: "Workspace",
      kind: "personal",
      bound: true,
      can_create_review: true,
      review_entitlements: plan
        ? { plan, project_limit: plan === "free" ? 5 : null, projects_used_up_to_limit: 2 }
        : null,
    } as Parameters<typeof presentSpaces>[0][number];
    const [result] = presentSpaces([space]);
    expect(result?.plan).toBe(plan ?? null);
    expect(result?.upgradeUrl).toBe(
      plan === "free" ? "https://hyperframes.dev/pricing?entry=local_studio_share" : null,
    );
  },
);
