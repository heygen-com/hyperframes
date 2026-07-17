export interface TimelineKeyframeTarget {
  percentage: number;
  tweenPercentage?: number;
  propertyGroup?: string;
  animationId?: string;
  collidingAnimationIds?: string[];
}

export function timelineKeyframeSelectionKey(
  elementId: string,
  target: TimelineKeyframeTarget,
): string {
  if (!target.propertyGroup) return `${elementId}:${target.percentage}`;
  const groupKey = target.animationId
    ? `${target.propertyGroup}:${target.animationId}`
    : target.propertyGroup;
  return `${elementId}:${groupKey}:${target.percentage}`;
}
