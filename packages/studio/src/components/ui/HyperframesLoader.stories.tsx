/**
 * HyperframesLoader and StatusFrame.
 *
 * Not an interactive control, so there are no hover, focus or disabled looks.
 * What varies is how much it is told: a title alone, a detail line, a mono
 * line for ids and counts, and a progress bar. The bar is a real
 * `role="progressbar"` with its value on it, which is what the a11y check
 * reads.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { HyperframesLoader, StatusFrame } from "./HyperframesLoader";

const meta: Meta<typeof HyperframesLoader> = {
  title: "Primitives/HyperframesLoader",
  component: HyperframesLoader,
  args: { title: "Opening project" },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithDetail: Story = {
  args: { title: "Rendering", detail: "Encoding the final mix" },
};

export const WithProgress: Story = {
  args: { title: "Rendering", detail: "Encoding the final mix", progress: 0.42, mono: "42%" },
};

/** Progress is clamped, so an out-of-range value cannot draw past the track. */
export const ProgressClamped: Story = {
  args: { title: "Rendering", progress: 2, mono: "100%" },
};

export const SmallMark: Story = { args: { title: "Loading", size: 28 } };

/** The full-bleed frame Studio shows while a project is still opening. */
export const Frame: Story = {
  render: (args) => <StatusFrame {...args} />,
  args: { title: "Opening project", detail: "Reading the composition" },
  parameters: { layout: "fullscreen" },
};
