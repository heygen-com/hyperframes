import { useState } from "react";
import type { CustomAgentDraft } from "./agentGlyphs";

const FIELD_CLASS =
  "w-full rounded-md bg-neutral-950/60 px-2 py-1 text-[11px] text-neutral-200 ring-1 " +
  "ring-white/10 outline-none transition-[box-shadow] duration-150 ease-out " +
  "placeholder:text-neutral-600 focus:ring-studio-accent/40";

/**
 * Register a harness Studio ships no preset for. The fields are exactly what a
 * preset carries — command, args, mark, model flag — so a CLI added here is a
 * first-class option in the picker rather than a one-machine env var.
 */
export function CustomAgentForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (draft: CustomAgentDraft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [icon, setIcon] = useState("");
  const [modelFlag, setModelFlag] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = label.trim().length > 0 && command.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const added = await onSubmit({
      label: label.trim(),
      // The prompt always arrives on stdin, so args are the flags around it.
      command: command.trim(),
      args: args.trim() ? args.trim().split(/\s+/) : [],
      icon: icon.trim() || undefined,
      modelFlag: modelFlag.trim() || undefined,
    });
    setSaving(false);
    if (added) onCancel();
  };

  return (
    <div className="space-y-1 p-1" data-custom-agent-form="true">
      <input
        autoFocus
        className={FIELD_CLASS}
        placeholder="Name (e.g. Pi)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className={FIELD_CLASS}
        placeholder="Command (e.g. pi)"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
      />
      <input
        className={FIELD_CLASS}
        placeholder="Args before the prompt on stdin (optional)"
        value={args}
        onChange={(e) => setArgs(e.target.value)}
      />
      <input
        className={FIELD_CLASS}
        placeholder="Icon file path (optional)"
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
      />
      <input
        className={FIELD_CLASS}
        placeholder="Model flag, e.g. --model (optional)"
        value={modelFlag}
        onChange={(e) => setModelFlag(e.target.value)}
      />
      <div className="flex items-center justify-end gap-1 pt-0.5">
        <button
          className="rounded-md px-2 py-1 text-[11px] leading-none text-neutral-400 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-200 active:scale-[0.96]"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="rounded-md bg-studio-accent px-2 py-1 text-[11px] font-medium leading-none text-neutral-950 transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saving ? "Adding…" : "Add harness"}
        </button>
      </div>
    </div>
  );
}
