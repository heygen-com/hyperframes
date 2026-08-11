/**
 * The install command, with a copy button that is always visible.
 *
 * A plain code fence renders a copy control only on hover, so it is invisible
 * to anyone who has not already guessed it is there, and absent from the
 * accessibility tree entirely. This is the one line on a catalog page that
 * every reader is here to take, so the affordance is spelled out.
 *
 * The button is icon-only, and both icons are Mintlify's own: the same
 * clipboard and check paths, at the same 16px, that the sitewide code-block
 * copy button draws. Two copy affordances sit on a catalog page, and they
 * should read as one control used twice. Sizing, hover plate, focus ring and
 * the brand-coloured check live in `custom.css` next to the rules that style
 * that sitewide button, so the pair cannot drift apart.
 *
 * The "Copied" announcement is a sibling `role="status"`, not a swapped
 * `aria-label`: it is the pattern Mintlify already uses on the code-block
 * button, so a screen reader hears the same word from both controls, and it
 * does not rename a control while it holds focus.
 *
 * navigator.clipboard is unavailable on insecure origins, which is exactly the
 * local `mint dev` preview these pages are written against. The textarea path
 * below is the fallback, not decoration.
 */
export const InstallCommand = ({ command, item }) => {
  const [copied, setCopied] = React.useState(false);

  /**
   * The values a reader tuned, read from the same query string the variables
   * panel writes.
   *
   * The URL is the shared state rather than a prop, because this line and the
   * panel are separate components mounted by MDX with no parent between them.
   * It also means a shared link and this command agree without either knowing
   * the other exists.
   *
   * Read after mount: the first render happens on the server, where there is
   * no query string to read.
   */
  const [tuned, setTuned] = React.useState("");

  React.useEffect(() => {
    if (!item) return;

    const read = () => {
      try {
        const raw = new URLSearchParams(window.location.search).get(`vars-${item}`);
        if (!raw) return setTuned("");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return setTuned("");
        if (Object.keys(parsed).length === 0) return setTuned("");
        setTuned(` --vars '${JSON.stringify(parsed)}'`);
      } catch {
        // A hand-edited link should leave the plain command, not break it.
        setTuned("");
      }
    };

    read();
    // `replaceState` fires nothing, so the panel says so itself; `popstate`
    // covers the back button.
    window.addEventListener("hf-vars-changed", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hf-vars-changed", read);
      window.removeEventListener("popstate", read);
    };
  }, [item]);

  const fullCommand = `${command}${tuned}`;

  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(fullCommand);
      } else {
        // The scratch textarea has to take focus to be selected, and removing
        // it drops focus on <body> — so a reader who copied with the keyboard
        // would Tab from the top of the page again. Hand focus back.
        const previous = document.activeElement;
        const scratch = document.createElement("textarea");
        scratch.value = fullCommand;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        document.body.removeChild(scratch);
        previous?.focus?.();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Leave the command on screen and selectable. Reporting a failure the
      // reader cannot act on is worse than letting them select it by hand.
    }
  };

  return (
    <div className="hf-install-command not-prose my-4 flex items-stretch overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <code className="flex-1 overflow-x-auto whitespace-nowrap border-r border-zinc-200 px-4 py-3 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:text-zinc-100">
        {fullCommand}
      </code>
      <button
        type="button"
        onClick={copy}
        data-copied={copied ? "true" : "false"}
        aria-label={`Copy ${command} to the clipboard`}
        className="hf-install-copy"
      >
        <svg
          className="hf-install-copy-clipboard"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14.25 5.25H7.25C6.14543 5.25 5.25 6.14543 5.25 7.25V14.25C5.25 15.3546 6.14543 16.25 7.25 16.25H14.25C15.3546 16.25 16.25 15.3546 16.25 14.25V7.25C16.25 6.14543 15.3546 5.25 14.25 5.25Z" />
          <path d="M2.80103 11.998L1.77203 5.07397C1.61003 3.98097 2.36403 2.96397 3.45603 2.80197L10.38 1.77297C11.313 1.63397 12.19 2.16297 12.528 3.00097" />
        </svg>
        <svg
          className="hf-install-copy-check"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.75 9.5L6.5 13.25L15.25 4.5" />
        </svg>
      </button>
      <span className="hf-install-copy-status" role="status" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </div>
  );
};
