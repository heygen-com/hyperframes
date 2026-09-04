/**
 * NumberField.
 *
 * The error look is the one worth a story: unparseable text commits nothing
 * and shows a red boundary rather than silently keeping the old number. That
 * state was internal-only, which no gallery and no screenshot could reach, so
 * the primitive gained the same `invalid` prop `Input` already had.
 */

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NumberField, type NumberFieldProps } from "./NumberField";

function Field({ initial = 48, ...props }: Partial<NumberFieldProps> & { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-40">
      <NumberField label="Font size" unit="px" value={value} onCommit={setValue} {...props} />
    </div>
  );
}

const meta: Meta<typeof NumberField> = {
  title: "Primitives/NumberField",
  component: NumberField,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Field /> };

export const Hover: Story = { render: () => <Field data-preview-state="hover" /> };

export const Focus: Story = { render: () => <Field data-preview-state="focus" /> };

export const Disabled: Story = { render: () => <Field disabled /> };

/**
 * What the field shows when its text does not parse: a red boundary, and no
 * commit. Clearing the field and blurring reaches the same state by hand.
 */
export const Error: Story = { render: () => <Field invalid /> };

export const Bounded: Story = {
  render: () => <Field label="Opacity" unit="%" initial={100} min={0} max={100} step={5} />,
};

export const NoUnit: Story = { render: () => <Field label="Repeat count" unit={undefined} /> };
