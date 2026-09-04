/**
 * Popover.
 *
 * Same floating chrome as `Menu`, no item semantics: the arrow keys belong to
 * whatever is focused inside. The stories are the two real shapes from Studio,
 * a small form and a two-mode panel, because the thing worth reviewing is that
 * a form inside the surface still reads as one system with a menu.
 */

import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Popover } from "./Popover";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import { NumberField } from "./NumberField";

const meta: Meta<typeof Popover> = {
  title: "Primitives/Popover",
  component: Popover,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Room for the portalled popup, which is placed below its trigger. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="h-64 w-72">{children}</div>;
}

export const Default: Story = {
  render: () => (
    <Frame>
      <Popover trigger={<Button>Grid spacing</Button>} aria-label="Grid spacing">
        <GridForm />
      </Popover>
    </Frame>
  ),
};

export const Open: Story = {
  render: () => (
    <Frame>
      <Popover
        defaultOpen
        data-preview-state="open"
        trigger={<Button>Grid spacing</Button>}
        aria-label="Grid spacing"
      >
        <GridForm />
      </Popover>
    </Frame>
  ),
};

/** The rename shape: a text field owns the keys, and takes focus on open. */
export const WithTextField: Story = {
  render: function RenameAsset() {
    const [name, setName] = useState("intro.mp4");
    return (
      <Frame>
        <Popover
          defaultOpen
          data-preview-state="open"
          trigger={<IconButton icon={<Ellipsis />} aria-label="Asset actions" />}
          aria-label="Rename asset"
        >
          <div className="flex w-48 flex-col gap-2">
            <Input value={name} onCommit={setName} aria-label="Asset name" />
            <Button variant="primary" size="sm">
              Rename
            </Button>
          </div>
        </Popover>
      </Frame>
    );
  },
};

function GridForm() {
  const [size, setSize] = useState(16);
  return (
    <div className="flex w-44 flex-col gap-2">
      <NumberField label="Grid size" unit="px" value={size} onCommit={setSize} min={1} />
    </div>
  );
}

function Ellipsis() {
  return (
    <svg width="12" height="3" viewBox="0 0 12 3" fill="currentColor" aria-hidden="true">
      <circle cx="1.5" cy="1.5" r="1.5" />
      <circle cx="6" cy="1.5" r="1.5" />
      <circle cx="10.5" cy="1.5" r="1.5" />
    </svg>
  );
}
