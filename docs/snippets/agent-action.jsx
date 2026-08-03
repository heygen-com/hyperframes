export const AgentAction = ({ request }) => {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef(null);

  const writeClipboard = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to the browser's older synchronous copy path.
    }

    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  };

  const copyRequest = async () => {
    if (await writeClipboard(request)) {
      setCopied(true);
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } else {
      setCopied(false);
    }
  };

  useEffect(
    () => () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  return (
    <div className="hf-agent-action">
      <div>
        <strong>Use this with your agent</strong>
        <span>Replace the URL with the page you want to show.</span>
      </div>
      <button type="button" onClick={copyRequest}>
        {copied ? "Copied" : "Copy request"}
      </button>
    </div>
  );
};
