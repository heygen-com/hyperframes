import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";
import type { DomEditSelection } from "./domEditingTypes";

export type ProbeTarget = { id?: string; hfId?: string; selector?: string; selectorIndex?: number };

function knownSourceAnswer(
  previous: DomEditSelection | null | undefined,
  element: HTMLElement,
  sourceFile: string,
  target: ProbeTarget,
): boolean | undefined {
  if (!previous || previous.element !== element || previous.sourceFile !== sourceFile) return;
  const same =
    previous.id === target.id &&
    previous.hfId === target.hfId &&
    previous.selector === target.selector &&
    previous.selectorIndex === target.selectorIndex;
  return same ? previous.existsInSource : undefined;
}

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

export async function existsInSourceFile(
  previous: DomEditSelection | null | undefined,
  element: HTMLElement,
  sourceFile: string,
  target: ProbeTarget,
  options: { projectId?: string | null; skipSourceProbe?: boolean },
): Promise<boolean | undefined> {
  const probeTarget: ProbeTarget = {};
  if (target.id) probeTarget.id = target.id;
  if (target.hfId) probeTarget.hfId = target.hfId;
  if (target.selector) probeTarget.selector = target.selector;
  if (target.selectorIndex != null) probeTarget.selectorIndex = target.selectorIndex;
  const known = knownSourceAnswer(previous, element, sourceFile, probeTarget);
  if (known !== undefined || options.skipSourceProbe || !options.projectId) return known;
  if (!target.id && !target.selector && !target.hfId) return known;
  return probeSourceElement(options.projectId, sourceFile, probeTarget);
}
