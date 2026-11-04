import { useRef, useState } from "react";
import type {
  LocalShareAction,
  LocalShareAudience,
  LocalShareJob,
  LocalShareSnapshot,
} from "@hyperframes/studio-server";
import { useMountEffect } from "../../hooks/useMountEffect";
import { LocalShareError, shareAction, shareJob, shareSnapshot } from "./localShareClient";
const STEP_LABELS: Record<string, string> = {
  preparing: "Preparing your video…",
  uploading: "Uploading your video…",
  processing: "Processing your video…",
  checking: "Checking your video…",
};
const failure = (error: unknown) =>
  error instanceof LocalShareError
    ? error.message
    : "Sharing couldn’t finish. Refresh to check its status.";

export function useQuickShare(token: string, beforeShare?: () => Promise<void>) {
  const [snapshot, setSnapshot] = useState<LocalShareSnapshot | null>(null);
  const [audience, setAudience] = useState<LocalShareAudience | "">("");
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progress, setProgress] = useState("");

  async function poll(job: LocalShareJob, signal: AbortSignal) {
    if (signal.aborted) return;
    if (job.state === "running") {
      setBusy(true);
      setProgress(STEP_LABELS[job.step] ?? "Preparing share…");
      timer.current = setTimeout(() => {
        void shareJob(token, job.id, signal)
          .then((next) => poll(next, signal))
          .catch((cause) => {
            if (!signal.aborted) {
              setError(failure(cause));
              setBusy(false);
            }
          });
      }, 1000);
      return;
    }
    setBusy(false);
    setProgress("");
    const result = job.result;
    if (result) setSnapshot((prior) => (prior ? { ...prior, share: result, job } : prior));
    await refresh(signal);
  }
  async function refresh(signal: AbortSignal) {
    setError(null);
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      const next = await shareSnapshot(token, signal);
      if (signal.aborted) return;
      setSnapshot(next);
      resetSelection(next);
      if (next.job?.error) setError(next.job.error.message);
      if (next.job?.state === "running") await poll(next.job, signal);
      else setBusy(false);
    } catch (cause) {
      reportFailure(cause, signal);
    }
  }
  useMountEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void refresh(controller.signal);
    return () => {
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  });
  async function run(action: LocalShareAction) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    setProgress("Preparing share…");
    try {
      if (["share", "update"].includes(action.action)) await beforeShare?.();
      if (!signal.aborted) await poll(await shareAction(token, action, signal), signal);
    } catch (cause) {
      reportFailure(cause, signal);
    }
  }
  function resetSelection(next: LocalShareSnapshot) {
    setAudience(next.share.audience ?? "");
    setSpaceId(next.share.spaceId ?? next.spaces.find((space) => space.bound)?.id ?? "");
  }
  function reportFailure(cause: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    setError(failure(cause));
    setBusy(false);
    setProgress("");
  }
  function reload() {
    if (lifetime.current) void refresh(lifetime.current.signal);
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Couldn’t copy. Open the shared page and copy its address.");
    }
  }
  return {
    snapshot,
    audience,
    setAudience,
    spaceId,
    setSpaceId,
    busy,
    error,
    copied,
    progress,
    run,
    reload,
    copy,
  };
}
export type QuickShareModel = ReturnType<typeof useQuickShare>;
