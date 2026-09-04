/**
 * Tabs.
 *
 * The strip is a real tablist, so the states worth showing are per tab:
 * selected (which hangs off `aria-selected`, the same attribute assistive tech
 * reads), hover, focus, and disabled. There is no error look for a tab strip.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tab, TabPanel, Tabs, TabsList } from "./Tabs";
import type { PreviewState } from "./Button";

const meta: Meta<typeof Tabs> = {
  title: "Primitives/Tabs",
  component: Tabs,
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The strip Studio's sidebar shows, with an optional forced look on tab two. */
function Strip({ previewState, disabled }: { previewState?: PreviewState; disabled?: boolean }) {
  return (
    <Tabs defaultValue="code">
      <TabsList aria-label="Sidebar panels">
        <Tab value="code">Code</Tab>
        <Tab value="assets" data-preview-state={previewState} disabled={disabled}>
          Assets
        </Tab>
        <Tab value="renders">Renders</Tab>
      </TabsList>
      <TabPanel value="code" className="p-3 text-step-11 text-text-2">
        The composition source.
      </TabPanel>
      <TabPanel value="assets" className="p-3 text-step-11 text-text-2">
        Images, audio and video.
      </TabPanel>
      <TabPanel value="renders" className="p-3 text-step-11 text-text-2">
        Finished renders.
      </TabPanel>
    </Tabs>
  );
}

/** Tab one is selected; the rest are at rest. */
export const Default: Story = { render: () => <Strip /> };

export const Hover: Story = { render: () => <Strip previewState="hover" /> };

export const Focus: Story = { render: () => <Strip previewState="focus" /> };

export const Disabled: Story = { render: () => <Strip disabled /> };
