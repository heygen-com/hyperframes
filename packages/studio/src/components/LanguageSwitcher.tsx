import { Translate } from "@phosphor-icons/react";
import { useStudioTranslation } from "../i18n/StudioI18nProvider";
import { normalizeStudioLanguage } from "../i18n/studioLanguage";
import { IconButton, Menu, MenuRadioGroup, MenuRadioItem } from "./ui";

const OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];

export function LanguageSwitcher() {
  const { t, instance, language, canSwitchLanguage } = useStudioTranslation();
  if (!canSwitchLanguage) return null;
  const label = t("language.label");
  return (
    <Menu
      align="end"
      aria-label={label}
      trigger={<IconButton aria-label={label} icon={<Translate size={16} />} />}
    >
      <MenuRadioGroup
        value={language}
        onValueChange={(next: string) => {
          const supported = normalizeStudioLanguage(next);
          if (supported) void instance.changeLanguage(supported);
        }}
      >
        {OPTIONS.map((option) => (
          <MenuRadioItem key={option.value} value={option.value} closeOnClick>
            <span lang={option.value}>{option.label}</span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  );
}
