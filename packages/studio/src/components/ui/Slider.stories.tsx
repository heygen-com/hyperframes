/**
 * Slider.
 *
 * `onPreview` is wired to the story's own state so dragging moves the thumb;
 * `onCommit` is what a consumer would write through. Keeping both visible is
 * the point of the primitive: one is continuous, the other is a boundary.
 *
 * There is no error look. A slider is clamped to its range, so it has no state
 * a value can be wrong in.
 */

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider, type SliderProps } from "./Slider";

function Control(props: Partial<SliderProps>) {
  const [value, setValue] = useState(40);
  return (
    <div className="w-56">
      <Slider
        label="Opacity"
        value={value}
        min={0}
        max={100}
        onPreview={setValue}
        onCommit={setValue}
        {...props}
      />
    </div>
  );
}

const meta: Meta<typeof Slider> = {
  title: "Primitives/Slider",
  component: Slider,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Control /> };

export const Hover: Story = { render: () => <Control data-preview-state="hover" /> };

/** Mid-drag: the thumb keeps the grabbing cursor while the button is down. */
export const Active: Story = { render: () => <Control data-preview-state="active" /> };

export const Focus: Story = { render: () => <Control data-preview-state="focus" /> };

export const Disabled: Story = { render: () => <Control disabled /> };

export const Stepped: Story = {
  render: () => <Control label="Playback rate" min={0.25} max={4} step={0.25} />,
};
