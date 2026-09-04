/**
 * Toggle.
 *
 * A switch, not a checkbox: it takes effect on flip and announces itself as
 * `role="switch"`. Checked and unchecked are separate stories because the
 * checked look is a different fill, border and thumb position, not a shade of
 * the same one. There is no error look for a switch.
 */

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toggle, type ToggleProps } from "./Toggle";

function Control({ initial = false, ...props }: Partial<ToggleProps> & { initial?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Toggle label="Loop playback" checked={checked} onCommit={setChecked} {...props} />;
}

const meta: Meta<typeof Toggle> = {
  title: "Primitives/Toggle",
  component: Toggle,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Control /> };

export const Checked: Story = { render: () => <Control initial /> };

export const Hover: Story = { render: () => <Control data-preview-state="hover" /> };

export const Focus: Story = { render: () => <Control data-preview-state="focus" /> };

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Control disabled />
      <Control disabled initial />
    </div>
  ),
};
