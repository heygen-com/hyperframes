import { CaretDown, Globe, Lock, Users, UserPlus } from "@phosphor-icons/react";
import type { LocalShareAudience, LocalShareSnapshot } from "@hyperframes/studio-server";
import { Menu, MenuRadioGroup, MenuRadioItem } from "../ui";
import { isAudience } from "./localShareClient";
import type { QuickShareModel } from "./useQuickShare";

const AUDIENCES = {
  public: { label: "Anyone with the link", detail: "Anyone you send the link to", icon: Globe },
  team: {
    label: "Anyone in this workspace",
    detail: "People in your signed-in workspace",
    icon: Users,
  },
  invite: {
    label: "Only invited people",
    detail: "People you add in Manage sharing",
    icon: UserPlus,
  },
  private: { label: "Only you", detail: "Only you can access this share", icon: Lock },
};

export function ShareAudience({
  model,
  snapshot,
}: {
  model: QuickShareModel;
  snapshot: LocalShareSnapshot;
}) {
  const selected = model.audience ? AUDIENCES[model.audience] : null;
  const Icon = selected?.icon ?? Lock;
  const space = snapshot.spaces.find((item) => item.id === model.spaceId);
  const choices: LocalShareAudience[] = ["public", "team", "invite"];
  if (snapshot.share.state !== "not_shared") choices.push("private");
  return (
    <Menu
      aria-label="Who can access"
      className="w-80 max-w-[calc(100vw-2rem)] rounded-xl p-1.5"
      trigger={
        <button
          type="button"
          aria-label="Who can access"
          disabled={model.busy || snapshot.share.state === "unavailable"}
          className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left text-step-13 hover:bg-hover disabled:opacity-40"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-press text-text-2">
            <Icon size={16} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 font-semibold">
            {selected?.label ?? "Choose who can access"}
          </span>
          <CaretDown size={14} aria-hidden="true" />
        </button>
      }
    >
      <MenuRadioGroup
        value={model.audience}
        onValueChange={(value) => {
          if (isAudience(value)) model.setAudience(value);
        }}
      >
        {choices.map((value) => {
          const option = AUDIENCES[value];
          const OptionIcon = option.icon;
          const needsPro = requiresPro(space, value, snapshot.share.audience);
          return (
            <MenuRadioItem
              key={value}
              value={value}
              closeOnClick
              disabled={
                model.busy ||
                (!space?.audiences.includes(value) && value !== snapshot.share.audience)
              }
              className="h-auto min-h-12 rounded-lg px-2 py-2 text-step-13"
            >
              <span className="flex items-center gap-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-press text-text-2">
                  <OptionIcon size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0 leading-snug">
                  <span className="flex items-center gap-2 font-semibold">
                    {option.label}
                    {needsPro ? (
                      <span className="rounded bg-press px-1.5 py-0.5 text-step-10 font-semibold">
                        Pro
                      </span>
                    ) : null}
                  </span>
                  <span className="block whitespace-normal text-step-11 text-text-3">
                    {needsPro ? "Upgrade to Pro to use this option" : option.detail}
                  </span>
                </span>
              </span>
            </MenuRadioItem>
          );
        })}
      </MenuRadioGroup>
      {space?.plan === "free" &&
      (!space.audiences.includes("team") || !space.audiences.includes("invite")) ? (
        <p className="mx-2 mt-1 border-t border-border px-1 py-2 text-step-11 text-text-2">
          Free includes anyone-with-the-link sharing. Upgrade to Pro for workspace and invite-only
          sharing.
        </p>
      ) : null}
    </Menu>
  );
}

function requiresPro(
  space: LocalShareSnapshot["spaces"][number] | undefined,
  value: LocalShareAudience,
  current: LocalShareAudience | null,
) {
  return (
    space?.plan === "free" &&
    !space.audiences.includes(value) &&
    value !== current &&
    (value === "team" || value === "invite")
  );
}
