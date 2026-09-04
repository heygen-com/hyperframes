/**
 * Select.
 *
 * The open popup is a portal, so the `Open` story renders inside a taller frame
 * and lets Base UI place the list; a story that forced the popup inline would
 * be showing a surface Studio never renders.
 */

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select, type SelectOption, type SelectProps } from "./Select";

const OPTIONS: SelectOption[] = [
  { label: "Linear", value: "linear" },
  { label: "Ease out", value: "ease-out" },
  { label: "Ease in out", value: "ease-in-out" },
  { label: "Spring", value: "spring" },
];

function Field(props: Partial<SelectProps>) {
  const [value, setValue] = useState("ease-out");
  return (
    <div className="w-56">
      <Select label="Easing" value={value} options={OPTIONS} onCommit={setValue} {...props} />
    </div>
  );
}

const meta: Meta<typeof Select> = {
  title: "Primitives/Select",
  component: Select,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Field /> };

export const Hover: Story = { render: () => <Field data-preview-state="hover" /> };

export const Focus: Story = { render: () => <Field data-preview-state="focus" /> };

export const Disabled: Story = { render: () => <Field disabled /> };

/**
 * The popup, with a highlighted row. It is portalled, so the story reserves
 * room below the trigger rather than letting the list overhang the canvas.
 */
export const Open: Story = {
  render: () => (
    <div className="h-56 pt-2">
      <Field defaultOpen />
    </div>
  ),
  parameters: { layout: "padded" },
};
