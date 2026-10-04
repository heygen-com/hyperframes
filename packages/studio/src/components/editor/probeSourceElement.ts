import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";

type ProbeTarget = { id?: string; hfId?: string; selector?: string; selectorIndex?: number };

interface PendingProbe {
  target: ProbeTarget;
  resolve: (exists: boolean) => void;
}

const pending = new Map<string, PendingProbe[]>();

async function sendBatch(projectId: string, sourceFile: string, probes: PendingProbe[]) {
  let exists: boolean[] = [];
  try {
    const response = await studioApiFetch(
      buildProjectApiPath(
        projectId,
        `/file-mutations/probe-elements/${encodeURIComponent(sourceFile)}`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: probes.map((probe) => probe.target) }),
      },
    );
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.exists)) exists = data.exists;
    }
  } catch {}
  probes.forEach((probe, index) => probe.resolve(exists[index] !== false));
}

export function probeSourceElement(
  projectId: string,
  sourceFile: string,
  target: ProbeTarget,
): Promise<boolean> {
  return new Promise((resolve) => {
    const key = `${projectId}\0${sourceFile}`;
    let probes = pending.get(key);
    if (!probes) {
      const batch: PendingProbe[] = [];
      probes = batch;
      pending.set(key, batch);
      setTimeout(() => {
        pending.delete(key);
        void sendBatch(projectId, sourceFile, batch);
      }, 0);
    }
    probes.push({ target, resolve });
  });
}
