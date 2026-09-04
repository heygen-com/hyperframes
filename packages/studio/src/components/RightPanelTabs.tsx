/**
 * The inspector panel's tab strip.
 *
 * It used to be a row of `aria-pressed` buttons, which no arrow key reached
 * and which assistive tech announced as five unrelated toggles. This is the
 * shared Tabs primitive, so the strip gets the roving tabindex, the arrow keys
 * and Home / End from the library rather than from nobody.
 *
 * The selected tab is derived, not stored: `active` comes from the panel state
 * the panel already keeps (which pane is open, which tab the layout holds), so
 * this component adds no second source for that decision. In the legacy split
 * inspector both Design and Layers can be open at once; one of them holds the
 * `aria-selected` state and the other still wears the selected look, because
 * both panes really are on screen.
 */

import { Tab, Tabs, TabsList, Tooltip, cn } from "./ui";

export interface RightPanelTabDescriptor {
  /** Stable id, also the `data-tab-id` attribute the strip is queried by. */
  id: string;
  label: string;
  tooltip: string;
  /** Whether this tab's content is on screen right now. */
  active: boolean;
  /** Run when the strip moves to this tab, by click or by arrow key. */
  onSelect: () => void;
}

/** The look `aria-selected` gives the selected tab, for a second open pane. */
const SELECTED_LOOK = "bg-hover text-text-0";

export function RightPanelTabs({ tabs }: { tabs: readonly RightPanelTabDescriptor[] }) {
  // `null` when the layout holds a tab this strip does not show (block params),
  // which leaves every tab unselected, exactly as the old buttons did.
  const value = tabs.find((tab) => tab.active)?.id ?? null;

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        tabs.find((tab) => tab.id === next)?.onSelect();
      }}
    >
      <TabsList
        aria-label="Inspector panels"
        className="flex min-w-0 items-center gap-1 overflow-hidden rounded-none border-b border-border-strong bg-transparent px-3 py-2"
      >
        {tabs.map((tab) => (
          <Tooltip key={tab.id} label={tab.tooltip} side="bottom">
            <Tab
              value={tab.id}
              className={cn("h-ctl-lg rounded-lg px-3 font-medium", tab.active && SELECTED_LOOK)}
            >
              {tab.label}
            </Tab>
          </Tooltip>
        ))}
      </TabsList>
    </Tabs>
  );
}
