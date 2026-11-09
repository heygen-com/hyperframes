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
  private: { label: "Only you", detail: "This existing share is private", icon: Lock },
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
  if (snapshot.share.audience === "private") choices.push("private");
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
                  <span className="block font-semibold">{option.label}</span>
                  <span className="block whitespace-normal text-step-11 text-text-3">
                    {option.detail}
                  </span>
                </span>
              </span>
            </MenuRadioItem>
          );
        })}
      </MenuRadioGroup>
    </Menu>
  );
}
