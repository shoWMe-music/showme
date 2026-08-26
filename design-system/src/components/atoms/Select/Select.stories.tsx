import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Select } from "./Select";

const COUNTRIES = [
  "Argentina",
  "Australia",
  "Austria",
  "Belgium",
  "Brazil",
  "Canada",
  "Chile",
  "Croatia",
  "Czechia",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Iceland",
  "Ireland",
  "Italy",
  "Japan",
  "Latvia",
  "Lithuania",
  "Mexico",
  "Netherlands",
  "New Zealand",
  "Norway",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "South Africa",
  "Spain",
  "Sweden",
  "Switzerland",
  "United Kingdom",
  "United States",
];

const meta: Meta<typeof Select> = {
  title: "Atoms/Select",
  component: Select,
  tags: ["autodocs"],
};
export default meta;

type Story = StoryObj<typeof Select>;

function Controlled({
  initial = "",
  ...props
}: { initial?: string } & Omit<React.ComponentProps<typeof Select>, "value" | "onChange">) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ width: 300, display: "grid", gap: 8 }}>
      <Select {...props} value={value} onChange={setValue} />
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
        value = {value === "" ? "—" : value}
      </code>
    </div>
  );
}

/** A long list is exactly what the search box is for: type "swe" instead of
 * scrolling to Sweden. */
export const Searchable: Story = {
  render: () => <Controlled label="Country" options={COUNTRIES} placeholder="Pick a country" />,
};

export const WithSelection: Story = {
  render: () => <Controlled label="Country" options={COUNTRIES} initial="Sweden" />,
};

/** Rich labels stay searchable through `searchText`. */
export const RichLabels: Story = {
  render: () => (
    <Controlled
      label="Currency"
      options={[
        { value: "EUR", label: "€ Euro", searchText: "EUR Euro" },
        { value: "SEK", label: "kr Swedish krona", searchText: "SEK Swedish krona" },
        { value: "GBP", label: "£ Pound sterling", searchText: "GBP Pound sterling" },
        { value: "USD", label: "$ US dollar", searchText: "USD US dollar" },
      ]}
      placeholder="Pick a currency"
    />
  ),
};

export const WithDisabledOption: Story = {
  render: () => (
    <Controlled
      label="Event role"
      options={[
        { value: "headliner", label: "Headliner" },
        { value: "support", label: "Support" },
        { value: "dj", label: "DJ", disabled: true },
        { value: "host", label: "Host" },
      ]}
    />
  ),
};

/** The behaviour this change replaced, kept as an opt-out: no search box, so
 * finding Sweden means scrolling 37 rows. */
export const WithoutSearch: Story = {
  render: () => (
    <Controlled
      label="Country"
      options={COUNTRIES}
      placeholder="Pick a country"
      searchable={false}
    />
  ),
};

/** Where opting out still earns its keep: a genuinely tiny, fixed choice. */
export const TinyChoice: Story = {
  render: () => (
    <Controlled label="Visibility" options={["Public", "Private"]} searchable={false} />
  ),
};

export const Disabled: Story = {
  render: () => <Controlled label="Country" options={COUNTRIES} initial="Norway" disabled />,
};

/** An option can say what choosing it MEANS, for a list where the words alone
 * do not settle it. */
export const WithDescriptions: Story = {
  render: () => (
    <Controlled
      label="Status"
      searchable={false}
      initial="pending"
      options={[
        {
          value: "draft",
          label: "Draft",
          description: "Yours alone. Nothing has been put to anybody yet.",
        },
        { value: "pending", label: "Pending", description: "Offered, and waiting on an answer." },
        {
          value: "confirmed",
          label: "Confirmed",
          description: "The booking is on. This is the status that counts against your plan.",
        },
      ]}
    />
  ),
};

/**
 * **A menu that asks before it commits.**
 *
 * Clicking an option is, in DOM terms, focus LEAVING the control — so anything
 * that has to be confirmed cannot be confirmed by the control losing focus. Give
 * the menu a `footer`, turn off `closeOnSelect`, and the choice becomes a draft
 * the footer resolves.
 *
 * `open` + `onOpenChange` are the other half: the caller decides when the menu is
 * up, and every way it can go away — Escape, a click outside, the trigger —
 * arrives as one `onOpenChange(false)`, so "cancel" has a single definition
 * rather than three. Tab runs trigger → footer → trigger and never escapes into
 * the document behind it.
 */
export const ConfirmBeforeCommitting: Story = {
  render: function ConfirmBeforeCommittingStory() {
    const [saved, setSaved] = useState("support");
    const [draft, setDraft] = useState(saved);
    const [open, setOpen] = useState(false);
    return (
      <div style={{ width: 300, display: "grid", gap: 8 }}>
        <Select
          label="Event role"
          searchable={false}
          value={draft}
          onChange={setDraft}
          options={[
            { value: "headliner", label: "Headliner", description: "Top of the bill." },
            { value: "support", label: "Support", description: "On before the headliner." },
            { value: "host", label: "Host", description: "Runs the room, does not play." },
          ]}
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            // Anything that is not Save leaves the value as it was.
            if (!next) setDraft(saved);
          }}
          closeOnSelect={false}
          footer={
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={draft === saved}
                onClick={() => {
                  setSaved(draft);
                  setOpen(false);
                }}
              >
                Save
              </Button>
            </div>
          }
        />
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
          saved = {saved} · draft = {draft}
        </code>
      </div>
    );
  },
};

/** A trigger sized to its own value — an inline table row rather than a form
 * column — would otherwise open a menu too narrow to read. `menuWidth` is a
 * floor, never a ceiling. */
export const NarrowTrigger: Story = {
  render: () => (
    <div style={{ width: 90 }}>
      <Controlled
        label="Room"
        options={["Main Hall", "Back Room"]}
        searchable={false}
        menuWidth={260}
      />
    </div>
  ),
};
