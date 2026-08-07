/**
 * The install command, with a copy button that is always visible.
 *
 * A plain code fence renders a copy control only on hover, so it is invisible
 * to anyone who has not already guessed it is there, and absent from the
 * accessibility tree entirely. This is the one line on a catalog page that
 * every reader is here to take, so the affordance is spelled out.
 *
 * navigator.clipboard is unavailable on insecure origins, which is exactly the
 * local `mint dev` preview these pages are written against. The textarea path
 * below is the fallback, not decoration.
 */
export const InstallCommand = ({ command }) => {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(command);
      } else {
        const scratch = document.createElement("textarea");
        scratch.value = command;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        document.body.removeChild(scratch);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Leave the command on screen and selectable. Reporting a failure the
      // reader cannot act on is worse than letting them select it by hand.
    }
  };

  return (
    <div className="not-prose my-4 flex items-stretch overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <code className="flex-1 overflow-x-auto whitespace-nowrap px-4 py-3 font-mono text-sm text-zinc-800 dark:text-zinc-100">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${command} to the clipboard`}
        className="shrink-0 border-l border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
};
