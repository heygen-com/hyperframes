export interface ClipboardTextControl {
  value: string;
  select(): void;
}

export function copySelectedText(
  text: string,
  control: ClipboardTextControl,
  executeCopy: () => boolean,
): boolean {
  control.value = text;
  control.select();
  try {
    return executeCopy();
  } finally {
    control.value = "";
  }
}
