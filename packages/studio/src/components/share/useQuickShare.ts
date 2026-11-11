import { useRef, useState } from "react";
import type {
  LocalShareAction,
  LocalShareAudience,
  LocalShareJob,
  LocalShareInteraction,
  LocalShareSnapshot,
} from "@hyperframes/studio-server";
import { useMountEffect } from "../../hooks/useMountEffect";
import { LocalShareError, shareAction, shareJob, shareSnapshot } from "./localShareClient";
import { shareInteraction } from "./localShareTelemetry";
const STEP_LABELS: Record<string, string> = {
  preparing: "Preparing your video…",
  signing_in: "Finish signing in in your browser…",
  uploading: "Uploading your video…",
  processing: "Processing your video…",
  checking: "Checking your video…",
};
const failure = (error: unknown) =>
  error instanceof LocalShareError
    ? error.message
    : "Sharing couldn’t finish. Try again to check its status.";

export function useQuickShare(token: string, beforeShare?: () => Promise<void>) {
  const [snapshot, setSnapshot] = useState<LocalShareSnapshot | null>(null);
  const [audience, setAudience] = useState<LocalShareAudience | "">("");
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusyState] = useState(false);
  const working = useRef(false);
  const reconnectOnReturn = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const { copied, setCopied, acknowledgeCopy } = useCopyAcknowledgement();
  const [notice, setNotice] = useState("");
  const opened = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progress, setProgress] = useState("");

  function setWorking(value: boolean) {
    working.current = value;
    setBusyState(value);
  }

  async function poll(job: LocalShareJob, signal: AbortSignal) {
    if (signal.aborted) return;
    if (job.state === "running") {
      setWorking(true);
      setProgress(STEP_LABELS[job.step] ?? "Preparing share…");
      timer.current = setTimeout(() => {
        void shareJob(token, job.id, signal)
          .then((next) => poll(next, signal))
          .catch((cause) => {
            reportFailure(cause, signal);
          });
      }, 1000);
      return;
    }
    setWorking(false);
    setProgress("");
    const result = job.result;
    if (result) setSnapshot((prior) => (prior ? { ...prior, share: result, job } : prior));
    await refresh(signal, job.state === "failed");
    if (!signal.aborted) setNotice(completionNotice(job));
  }
  async function refresh(signal: AbortSignal, preserveSelection = false) {
    setError(null);
    setErrorCode(null);
    setWorking(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      const next = await shareSnapshot(token, signal);
      if (signal.aborted) return;
      recordOpen(next);
      reconnectOnReturn.current = false;
      setSnapshot(next);
      if (!preserveSelection) resetSelection(next);
      if (next.job?.error) {
        setError(next.job.error.message);
        setErrorCode(next.job.error.code);
      }
      if (next.job?.state === "running") await poll(next.job, signal);
      else setWorking(false);
      return true;
    } catch (cause) {
      reportFailure(cause, signal);
      return false;
    }
  }
  useMountEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const resume = () => {
      if (document.visibilityState !== "hidden" && reconnectOnReturn.current && !working.current)
        void refresh(controller.signal);
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    void refresh(controller.signal);
    return () => {
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  });
  async function run(action: LocalShareAction) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || working.current) return;
    track({ event: "share_action_clicked", action: action.action });
    setWorking(true);
    setError(null);
    setErrorCode(null);
    setCopied(false);
    setNotice("");
    setProgress("Preparing share…");
    try {
      if (["share", "update"].includes(action.action)) await beforeShare?.();
      if (!signal.aborted) await poll(await shareAction(token, action, signal), signal);
    } catch (cause) {
      await recoverActionFailure(cause, signal);
    }
  }
  async function recoverActionFailure(cause: unknown, signal: AbortSignal) {
    if (
      cause instanceof LocalShareError &&
      [
        "login_changed",
        "login_expired",
        "unauthenticated",
        "refresh_failed",
        "not_configured",
      ].includes(cause.code)
    ) {
      reportFailure(cause, signal);
      return;
    }
    setProgress("");
    const recovered = await refresh(signal, true);
    if (recovered && !signal.aborted) {
      setError(failure(cause));
      setErrorCode(cause instanceof LocalShareError ? cause.code : null);
    }
  }
  function recordOpen(value: LocalShareSnapshot | null) {
    if (opened.current) return;
    opened.current = true;
    const share = value?.share;
    const link = share?.url ? (share.changed ? "changed" : "live") : "none";
    shareInteraction(token, { event: "share_opened", link });
  }
  function resetSelection(next: LocalShareSnapshot) {
    setAudience(next.share.audience ?? "");
    setSpaceId(next.share.spaceId ?? next.spaces.find((space) => space.bound)?.id ?? "");
  }
  function reportFailure(cause: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    recordOpen(null);
    reconnectOnReturn.current = true;
    setSnapshot(null);
    setCopied(false);
    setError(failure(cause));
    setErrorCode(cause instanceof LocalShareError ? cause.code : null);
    if (cause instanceof LocalShareError && cause.job?.state === "running") {
      void poll(cause.job, signal);
      return;
    }
    setWorking(false);
    setProgress("");
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      if (lifetime.current?.signal.aborted) return;
      acknowledgeCopy();
      shareInteraction(token, { event: "share_link_copied", via: "copy" });
    } catch {
      setError("Couldn’t copy. Open the shared page and copy its address.");
    }
  }
  const track = (event: LocalShareInteraction) => shareInteraction(token, event);
  return {
    track,
    snapshot,
    audience,
    setAudience: (value: LocalShareAudience) => {
      setAudience(value);
      track({ event: "share_audience_selected", audience: value });
    },
    spaceId,
    busy,
    error,
    errorCode,
    copied,
    notice,
    progress,
    run,
    copy,
  };
}
export type QuickShareModel = ReturnType<typeof useQuickShare> & {
  includeSource: boolean;
  setIncludeSource: (value: boolean) => void;
};

function completionNotice(job: LocalShareJob) {
  if (job.state !== "done") return "";
  if (job.result?.upToDate) return "Already up to date.";
  return job.result?.updated ? "Shared version updated." : "";
}

function useCopyAcknowledgement() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useMountEffect(() => () => clearTimeout(timer.current));
  function acknowledgeCopy() {
    clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }
  return { copied, setCopied, acknowledgeCopy };
}
