import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
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
