/**
 * Tooltip.
 *
 * The bubble is portalled and opens on hover or focus, which no attribute can
 * force, so the open story controls Base UI's own root through a zero delay and
 * a trigger that takes focus. What the gallery is really for here is the
 * placement: the same label on all four sides, against the same surface.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "./Tooltip";
import { IconButton } from "./IconButton";

const meta: Meta<typeof Tooltip> = {
  title: "Primitives/Tooltip",
  component: Tooltip,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof meta>;

function ZoomIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="5" cy="5" r="3.5" stroke="currentColor" />
      <path d="M8 8l3 3" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/** Hover or focus the control; the bubble follows after the delay. */
export const Default: Story = {
  render: () => (
    <div className="p-8">
      <Tooltip label="Zoom to fit">
        <IconButton icon={<ZoomIcon />} aria-label="Zoom to fit" />
      </Tooltip>
    </div>
  ),
};

/** No delay, so a keyboard focus shows the bubble immediately. */
export const NoDelay: Story = {
  render: () => (
    <div className="p-8">
      <Tooltip label="Zoom to fit" delay={0}>
        <IconButton icon={<ZoomIcon />} aria-label="Zoom to fit" />
      </Tooltip>
    </div>
  ),
};

export const Sides: Story = {
  render: () => (
    <div className="flex items-center gap-8 p-12">
      {(["top", "bottom", "left", "right"] as const).map((side) => (
        <Tooltip key={side} label={`Opens ${side}`} side={side} delay={0}>
          <IconButton icon={<ZoomIcon />} aria-label={`Opens ${side}`} />
        </Tooltip>
      ))}
    </div>
  ),
};
