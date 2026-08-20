/**
 * A collapsed group's header row in the flat inspector.
 *
 * Its own module so `PropertyPanelFlat.tsx` stays under the studio's 600-line
 * cap; it reads only its arguments, which is what makes it separable.
 */

import { DesignPanelInputProvider } from "../../contexts/DesignPanelInputContext";
import { slugifyDesignInput } from "../../utils/designInputTracking";
import { FlatGroupHeader } from "./propertyPanelFlatPrimitives";
import type { FlatGroupDescriptor } from "./propertyPanelFlatDescriptors";

/** Its title, its one-line summary, and the entrance animation only the group
 *  just toggled gets. */
export function closedGroupHeader(
  group: FlatGroupDescriptor,
  toggleOpen: (id: string) => void,
  justToggledIds: readonly string[],
) {
  return (
    <DesignPanelInputProvider key={group.id} section={slugifyDesignInput(group.title)}>
      <FlatGroupHeader
        title={group.title}
        isOpen={false}
        onToggleOpen={() => toggleOpen(group.id)}
        summary={group.summary}
        animateEntrance={justToggledIds.includes(group.id)}
      />
    </DesignPanelInputProvider>
  );
}
