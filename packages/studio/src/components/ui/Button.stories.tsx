/**
 * Button (AE8).
 *
 * Every interactive look is a named story that renders without a pointer:
 * `data-preview-state` repeats the hover, active and focus classes as plain
 * attribute selectors, so a reviewer (and a screenshot) sees the real look
 * rather than a description of it. `Button.test.tsx` is what keeps the two
 * lists from drifting.
 *
 * Button has no error prop; its error look is the `danger` variant, which is
 * what the `Error` story shows.
 */

import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "danger", "ghost"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

const meta: Meta<typeof Button> = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Export" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: SIZES },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** A row of one story's args, once per variant. */
function VariantRow(args: ComponentProps<typeof Button>) {
  return (
    <div className="flex items-center gap-3">
      {VARIANTS.map((variant) => (
        <Button key={variant} {...args} variant={variant} />
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

/** Button's error look. A destructive action wears `danger`, not a flag. */
export const Error: Story = { args: { variant: "danger", children: "Delete" } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {SIZES.map((size) => (
        <Button key={size} {...args} size={size} variant="primary" />
      ))}
    </div>
  ),
};

export const Loading: Story = { args: { loading: true, variant: "primary" } };

export const WithIcon: Story = {
  args: {
    variant: "secondary",
    icon: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    children: "Add track",
  },
};
