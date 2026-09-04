/**
 * IconButton.
 *
 * Same base and variant classes as Button, so the interesting stories are the
 * ones Button cannot show: the square boxes on the three control heights, and
 * the fact that `aria-label` is required rather than optional. An icon-only
 * control with no accessible name is what the a11y addon exists to catch, and
 * the type will not let a story create one.
 */

import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";
import type { ButtonSize, ButtonVariant } from "./Button";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "danger", "ghost"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

const PlusIcon = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const meta: Meta<typeof IconButton> = {
  title: "Primitives/IconButton",
  component: IconButton,
  args: { icon: PlusIcon, "aria-label": "Add track" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: SIZES },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

function VariantRow(args: ComponentProps<typeof IconButton>) {
  return (
    <div className="flex items-center gap-3">
      {VARIANTS.map((variant) => (
        <IconButton key={variant} {...args} variant={variant} />
      ))}
    </div>
  );
}

export const Default: Story = { render: (args) => <VariantRow {...args} /> };

export const Hover: Story = {
  render: (args) => <VariantRow {...args} data-preview-state="hover" />,
};

export const Active: Story = {
  render: (args) => <VariantRow {...args} data-preview-state="active" />,
};

export const Focus: Story = {
  render: (args) => <VariantRow {...args} data-preview-state="focus" />,
};

export const Disabled: Story = { render: (args) => <VariantRow {...args} disabled /> };

/** IconButton's error look, as with Button, is the `danger` variant. */
export const Error: Story = { args: { variant: "danger", "aria-label": "Delete track" } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {SIZES.map((size) => (
        <IconButton key={size} {...args} size={size} variant="secondary" />
      ))}
    </div>
  ),
};
