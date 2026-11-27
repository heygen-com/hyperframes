import { useState } from "react";
import { Button } from "../ui";
import { useMountEffect } from "../../hooks/useMountEffect";
import { reconnectChoices, confirmReconnect } from "./localShareClient";

type Choices = Awaited<ReturnType<typeof reconnectChoices>>;
type Props = { token: string; space: string; onCancel: () => void; onConnected: () => void };

export function ReconnectProject({ token, space, onCancel, onConnected }: Props) {
  const [choices, setChoices] = useState<Choices>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Loading cloud projects…");
  useMountEffect(() => {
    const controller = new AbortController();
    void reconnectChoices(token, space, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setChoices(items);
        setStatus(items.length ? "" : "No cloud projects in this workspace.");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setStatus(messageOf(error));
      });
    return () => controller.abort();
  });
  const choice = choices.find((item) => item.token === selected);
  async function confirm() {
    if (!choice) return;
    setBusy(true);
    try {
      await confirmReconnect(token, choice.token, AbortSignal.timeout(30_000));
      onConnected();
    } catch (error) {
      setChoices([]);
      setStatus(messageOf(error));
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2 text-step-12 text-text-3">
      {status ? (
        <p role="status">{status}</p>
      ) : (
        <label>
          Existing cloud project in <bdi>{choices[0]!.workspace.name}</bdi>
          <select
            value={selected}
            disabled={busy}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a project</option>
            {choices.map((item) => (
              <option key={item.token} value={item.token}>
                {item.title} ({item.id})
              </option>
            ))}
          </select>
        </label>
      )}
      {choice && (
        <p>
          Future syncs will publish versions of <bdi>{choice.title}</bdi> in{" "}
          <bdi>
            {choice.workspace.name} ({choice.workspace.id})
          </bdi>
          .
        </p>
      )}
      <Button disabled={!choice || busy} onClick={() => void confirm()}>
        Confirm reconnect
      </Button>
      <Button variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Could not reconnect. Try again.";
}
