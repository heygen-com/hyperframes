/**
 * Driving a `FlatSelectRow` from a test, now that it is a Base UI select and
 * not a native one.
 *
 * A native `<select>` could be changed in one line: set `value`, dispatch
 * `change`. A listbox cannot, because its options only exist while the popup is
 * open and the popup mounts in a portal a task after the trigger is pressed. So
 * the sequence lives here once instead of in each section's test file.
 *
 * Deliberately not named `*.test.*`: vitest collects by that suffix, and a
 * helper module with no tests in it would fail collection.
 */
import { act } from "react";

/** Base UI mounts and unmounts the popup a task later; happy-dom is no faster. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

export function flatSelectRow(host: HTMLElement, label: string) {
  const rows = Array.from(host.querySelectorAll<HTMLElement>(".group"));
  const row = rows.find((el) => el.querySelector("span")?.textContent === label);
  if (!row) throw new Error(`expected a select row for "${label}"`);
  const trigger = row.querySelector<HTMLElement>('[role="combobox"]');
  if (!trigger) throw new Error(`expected a select trigger for "${label}"`);
  const resetButton = row.querySelector<HTMLButtonElement>('[data-flat-select-reset="true"]');
  return { row, trigger, resetButton };
}

/** Opens the popup and returns its options, which exist only while it is open. */
export async function openFlatSelect(host: HTMLElement, label: string): Promise<HTMLElement[]> {
  const { trigger } = flatSelectRow(host, label);
  act(() => trigger.click());
  await settle();
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** Picks from a list already open, so a caller that inspected it first does not
 *  have to reopen the popup — pressing the trigger again would close it. */
export async function chooseOpenOption(options: HTMLElement[], optionText: string): Promise<void> {
  const option = options.find((el) => el.textContent === optionText);
  if (!option) {
    throw new Error(
      `no option "${optionText}", among ${JSON.stringify(options.map((el) => el.textContent))}`,
    );
  }
  act(() => option.click());
  await settle();
}

export async function chooseFlatSelectOption(
  host: HTMLElement,
  label: string,
  optionText: string,
): Promise<void> {
  await chooseOpenOption(await openFlatSelect(host, label), optionText);
}
