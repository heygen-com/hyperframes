import { create } from "zustand";
import { readStudioUiPreferences, writeStudioUiPreferences } from "./studioUiPreferences";

/** Whether the audio meter strip is shown; persisted, on unless the user hid it. */
export const useAudioMetersVisible = create<{
  visible: boolean;
  setVisible: (visible: boolean) => void;
}>((set) => ({
  visible: readStudioUiPreferences().audioMetersVisible ?? true,
  setVisible: (visible) => {
    writeStudioUiPreferences({ audioMetersVisible: visible });
    set({ visible });
  },
}));
