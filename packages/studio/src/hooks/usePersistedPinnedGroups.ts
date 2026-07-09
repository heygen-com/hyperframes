import { useCallback, useState } from "react";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../utils/studioUiPreferences";

export function usePersistedPinnedGroups(elementKind: string) {
  const [pinnedGroupIds, setPinnedGroupIds] = useState<string[]>(
    () => readStudioUiPreferences().pinnedGroupsByElementType?.[elementKind] ?? [],
  );

  const togglePin = useCallback(
    (groupId: string) => {
      setPinnedGroupIds((current) => {
        const next = current.includes(groupId)
          ? current.filter((id) => id !== groupId)
          : [...current, groupId];
        const existing = readStudioUiPreferences().pinnedGroupsByElementType ?? {};
        writeStudioUiPreferences({
          pinnedGroupsByElementType: { ...existing, [elementKind]: next },
        });
        return next;
      });
    },
    [elementKind],
  );

  return { pinnedGroupIds, togglePin };
}
