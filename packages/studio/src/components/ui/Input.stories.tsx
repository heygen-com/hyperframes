/**
 * Input.
 *
 * The stories hold a draft of their own because the primitive's contract is
 * draft-then-commit: typing moves local state, Enter and blur commit, Escape
 * abandons. A story that passed a constant `value` would look frozen and would
 * misrepresent the control.
 */

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input, type InputProps } from "./Input";

/** A committed value that lives for the life of the story. */
function Field({ initial = "Intro card", ...props }: Partial<InputProps> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-56">
      <Input value={value} onCommit={setValue} aria-label="Layer name" {...props} />
    </div>
  );
}

const meta: Meta<typeof Input> = {
  title: "Primitives/Input",
  component: Input,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Field /> };

export const Hover: Story = { render: () => <Field data-preview-state="hover" /> };

export const Focus: Story = { render: () => <Field data-preview-state="focus" /> };

export const Disabled: Story = { render: () => <Field disabled /> };

/** `invalid` sets both the red boundary and `aria-invalid`. */
export const Error: Story = { render: () => <Field invalid initial="" /> };

export const Placeholder: Story = {
  render: () => <Field initial="" placeholder="Untitled layer" />,
};
