import { useTranslation } from "react-i18next";
import { Eye, Layers } from "../../icons/SystemIcons";

export function PropertyPanelEmptyState({ multiSelectCount }: { multiSelectCount: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {multiSelectCount > 1 ? (
          <>
            <Layers size={18} className="mb-3 text-neutral-600" />
            <p className="text-sm font-medium text-neutral-200">
              {t("propertyPanel.multiSelect", { count: multiSelectCount })}
            </p>
            <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
              {t("propertyPanel.multiSelectHint")}
            </p>
          </>
        ) : (
          <>
            <Eye size={18} className="mb-3 text-neutral-600" />
            <p className="text-sm font-medium text-neutral-200">{t("propertyPanel.noSelection")}</p>
            <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
              {t("propertyPanel.inspectorIntro")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
