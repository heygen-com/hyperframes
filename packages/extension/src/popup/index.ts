export {};

const status = document.querySelector<HTMLElement>("#status");
const done = document.querySelector<HTMLButtonElement>("#done");
if (!status || !done) throw new Error("Popup controls are missing.");

done.addEventListener("click", () => window.close());

void chrome.runtime.sendMessage({ kind: "activate" }).then(
  (response: unknown) => {
    if (
      response !== null &&
      typeof response === "object" &&
      "ok" in response &&
      response.ok === true
    ) {
      status.textContent = "Picker opened.";
      window.close();
      return;
    }
    status.textContent =
      response !== null && typeof response === "object" && "message" in response
        ? String(response.message)
        : "The picker could not open on this page.";
    done.hidden = false;
    done.focus();
  },
  () => {
    status.textContent = "The picker could not open on this page.";
    done.hidden = false;
    done.focus();
  },
);
