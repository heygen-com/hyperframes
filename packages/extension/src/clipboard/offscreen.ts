import { parseExtensionRequest } from "../protocol";
import { copySelectedText } from "./copy";

const clipboardControl = document.querySelector<HTMLTextAreaElement>("#clipboard");
if (!clipboardControl) throw new Error("The offscreen clipboard control is missing.");

chrome.runtime.onMessage.addListener((raw, _sender, respond) => {
  const message = parseExtensionRequest(raw);
  if (message?.kind === "offscreen.ping") {
    respond({ ok: true, kind: "offscreen.ready" });
    return;
  }
  if (message?.kind !== "offscreen.write") return;
  const copied = copySelectedText(message.text, clipboardControl, () =>
    document.execCommand("copy"),
  );
  respond(
    copied
      ? { ok: true, kind: "offscreen.written" }
      : {
          ok: false,
          code: "clipboard.write-failed",
          message: "Chrome rejected the offscreen copy command.",
        },
  );
});
