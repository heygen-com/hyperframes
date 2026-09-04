/**
 * Menu, ContextMenu and their items.
 *
 * The open stories use `defaultOpen`, not a scripted click. Base UI reads a
 * bare programmatic `click()` as keyboard activation and focuses the first
 * item, which is a different look from a pointer-opened menu; asking for the
 * open state directly avoids claiming one while showing the other.
 *
 * `data-preview-state="open"` pins the settled open look, so a screenshot
 * cannot catch the popup mid-transition.
 */

import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextMenu, Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "./Menu";
import { Button } from "./Button";

const meta: Meta<typeof Menu> = {
  title: "Primitives/Menu",
  component: Menu,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Room for the portalled popup, which is placed below its trigger. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="h-64 w-72">{children}</div>;
}

const Items = (
  <>
    <MenuItem shortcut="⌘D">Duplicate</MenuItem>
    <MenuItem shortcut="⌘G">Group</MenuItem>
    <MenuItem disabled>Convert to sub-composition</MenuItem>
    <MenuSeparator />
    <MenuItem tone="danger" shortcut="⌫">
      Delete
    </MenuItem>
  </>
);

/** The trigger at rest. Press it, or use the `Open` story. */
export const Default: Story = {
  render: () => (
    <Frame>
      <Menu trigger={<Button>Layer</Button>} aria-label="Layer actions">
        {Items}
      </Menu>
    </Frame>
  ),
};

export const Open: Story = {
  render: () => (
    <Frame>
      <Menu
        defaultOpen
        data-preview-state="open"
        trigger={<Button>Layer</Button>}
        aria-label="Layer actions"
      >
        {Items}
      </Menu>
    </Frame>
  ),
};

/** The highlight, shown without a pointer. Disabled and danger rows beside it. */
export const ItemHover: Story = {
  render: () => (
    <Frame>
      <Menu
        defaultOpen
        data-preview-state="open"
        trigger={<Button>Layer</Button>}
        aria-label="Layer actions"
      >
        <MenuItem data-preview-state="hover" shortcut="⌘D">
          Duplicate
        </MenuItem>
        <MenuItem shortcut="⌘G">Group</MenuItem>
        <MenuItem disabled>Convert to sub-composition</MenuItem>
        <MenuSeparator />
        <MenuItem tone="danger" shortcut="⌫">
          Delete
        </MenuItem>
      </Menu>
    </Frame>
  ),
};

/** Single choice, the shape SpeedMenu takes. Selection is `aria-checked`. */
export const RadioItems: Story = {
  render: function RadioMenu() {
    const [rate, setRate] = useState("1");
    return (
      <Frame>
        <Menu
          defaultOpen
          data-preview-state="open"
          trigger={<Button>{`${rate}x`}</Button>}
          aria-label="Playback rate"
        >
          <MenuRadioGroup value={rate} onValueChange={(next) => setRate(String(next))}>
            {["0.5", "1", "1.5", "2"].map((value) => (
              <MenuRadioItem key={value} value={value}>
                {`${value}x`}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Menu>
      </Frame>
    );
  },
};

/** Right-click the surface. The popup is anchored to the pointer, not the box. */
export const ContextMenuOnCanvas: Story = {
  render: () => (
    <Frame>
      <ContextMenu
        aria-label="Canvas actions"
        trigger={
          <div className="flex h-24 w-full items-center justify-center rounded-md border border-border-input bg-surface text-step-11 text-text-2">
            Right-click here
          </div>
        }
      >
        {Items}
      </ContextMenu>
    </Frame>
  ),
};
