import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TextField } from "../TextField/TextField";
import { TagInput } from "./TagInput";

const meta: Meta<typeof TagInput> = {
  title: "Atoms/TagInput",
  component: TagInput,
  tags: ["autodocs"],
};
export default meta;

type Story = StoryObj<typeof TagInput>;

function Controlled({
  initial,
  ...props
}: { initial: string[] } & Omit<React.ComponentProps<typeof TagInput>, "value" | "onChange">) {
  const [tags, setTags] = useState<string[]>(initial);
  return (
    <div style={{ width: 360, display: "grid", gap: 8 }}>
      <TagInput {...props} value={tags} onChange={setTags} />
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
        {JSON.stringify(tags)}
      </code>
    </div>
  );
}

/** Empty means empty: the placeholder shows and the value is `[]`. */
export const Empty: Story = {
  render: () => (
    <Controlled
      initial={[]}
      label="Genres"
      placeholder="Type a genre and press Enter"
      hint="Enter or comma adds it. Backspace on an empty box takes the last one back."
    />
  ),
};

export const WithTags: Story = {
  render: () => (
    <Controlled initial={["Indie", "Post-Punk", "Shoegaze"]} label="Genres" placeholder="Add…" />
  ),
};

/**
 * The pattern this replaces, side by side. On the left is a `TextField` labelled
 * "(comma-separated)" whose value is `split(",")` on save — nothing shows what
 * is stored, `Indie,Rock` and `Indie, Rock` store differently, a trailing comma
 * stores an empty value, and removing the middle item means editing a string by
 * hand. On the right the same three values are three things you can see and
 * delete one at a time.
 */
export const BeforeVersusAfter: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: 740 }}>
      <TextField
        label="Before — comma-separated"
        value="Indie, Post-Punk, Shoegaze"
        readOnly
        onChange={() => {}}
      />
      <Controlled initial={["Indie", "Post-Punk", "Shoegaze"]} label="After — pills" />
    </div>
  ),
};

/** Long values wrap the field downwards rather than sideways — including a
 * single unbroken token, which breaks mid-word inside its own pill. The frame
 * never exceeds its container at any width. */
export const LongValuesWrap: Story = {
  render: () => (
    <div style={{ width: 260 }}>
      <Controlled
        initial={[
          "Experimental Electronic",
          "Nordic Folk Revival",
          "AnAbsurdlyLongUnbrokenGenreNameThatHasNoSpaces",
          "Jazz",
        ]}
        label="Genres"
      />
    </div>
  ),
};

/** A cap. The box disappears once the list is full and says why. */
export const Capped: Story = {
  render: () => (
    <Controlled
      initial={["Indie", "Techno"]}
      label="Genres"
      maxTags={3}
      maxTagLength={40}
      placeholder="One more…"
    />
  ),
};

/** Duplicates are rejected case-insensitively, and the FIRST spelling wins —
 * adding "techno" to a list that already has "Techno" changes nothing. */
export const DuplicatesRejected: Story = {
  render: () => (
    <Controlled initial={["Techno"]} label="Try adding “techno” again" placeholder="techno" />
  ),
};

/** Read-only: pills stay legible, the × and the box are gone. */
export const Disabled: Story = {
  render: () => <Controlled initial={["Indie", "Shoegaze"]} label="Genres" disabled />,
};
