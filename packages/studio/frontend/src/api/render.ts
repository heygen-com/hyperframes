import { validatedApiFetch } from "./client";
import { StartRenderResponseSchema, RenderProgressSchema } from "./schemas";
import type { Infer } from "./validate";

export type RenderProgress = Infer<typeof RenderProgressSchema>;

const fetchStartRender = validatedApiFetch(StartRenderResponseSchema);

export async function startRender(projectId: string, options?: { debug?: boolean; sequential?: boolean }): Promise<string> {
  const res = await fetchStartRender(
    `/projects/${projectId}/render`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        debug: options?.debug ?? false,
        sequential: options?.sequential ?? false,
      }),
    }
  );
  return res.jobId;
}

export function subscribeProgress(
  jobId: string,
  onProgress: (data: RenderProgress) => void,
  onError?: (error: Event) => void
): () => void {
  const eventSource = new EventSource(`/api/render/${jobId}/progress`);

  eventSource.addEventListener("progress", (event) => {
    try {
      const result = RenderProgressSchema.safeParse(JSON.parse(event.data));
      if (result.success) {
        onProgress(result.data);
      }
    } catch (err: unknown) {
      // Malformed JSON — ignore
    }
  });

  if (onError) {
    eventSource.onerror = onError;
  }

  return () => eventSource.close();
}

export function getDownloadUrl(jobId: string): string {
  return `/api/render/${jobId}/download`;
}
