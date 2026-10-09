// Music sits under narration; a silent film brings music forward.
export const BGM_BED_VOLUME = 0.12;
export const BGM_SILENT_VOLUME = 0.9;
export const bgmDefaultVolume = (hasVoice) => (hasVoice ? BGM_BED_VOLUME : BGM_SILENT_VOLUME);
