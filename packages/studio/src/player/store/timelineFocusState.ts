export interface TimelineFocusRequest {
  id: string;
  projectId: string | null;
  sessionEpoch: number;
  nonce: number;
  reveal: boolean;
}

export function createTimelineFocusRequest(
  id: string,
  projectId: string | null,
  sessionEpoch: number,
  nonce: number,
  reveal = true,
): TimelineFocusRequest {
  return { id, projectId, sessionEpoch, nonce, reveal };
}
