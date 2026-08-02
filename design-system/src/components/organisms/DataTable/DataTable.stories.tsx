import type { Meta, StoryObj } from "@storybook/react";
import { DataTable, type DataTableColumn } from "./DataTable";
import { Badge } from "@/components/atoms/Badge/Badge";
import type { Status } from "@/lib/status";

const meta = {
  title: "Organisms/DataTable",
  component: DataTable,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DataTable>;
export default meta;
type Story = StoryObj;

/* small inline cell helpers (mirror the prototype's cell markup) */
const primary = { fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" } as const;
const sub = { display: "block", color: "var(--muted)", fontSize: 12.5 } as const;
const mono = { fontFamily: "var(--font-mono)", fontSize: 13 } as const;

/* ============================ Events ============================ */
interface EventRow {
  id: string; artist: string; name: string; venue: string; date: string; cap: string;
  status: { label: string; hue: Status }; settlement: { label: string; hue: Status };
}

const EVENTS: EventRow[] = [
  { id: "1", artist: "Kiasmos", name: "Södra Sessions", venue: "Södra Teatern", date: "2026-09-12", cap: "1,200", status: { label: "Confirmed", hue: "confirmed" }, settlement: { label: "Owed", hue: "pending" } },
  { id: "2", artist: "Nils Frahm", name: "Piano Day", venue: "Berns", date: "2026-09-20", cap: "900", status: { label: "On hold", hue: "hold" }, settlement: { label: "Draft", hue: "draft" } },
  { id: "3", artist: "Jon Hopkins", name: "Immunity Live", venue: "Fållan", date: "2026-10-03", cap: "1,500", status: { label: "Confirmed", hue: "confirmed" }, settlement: { label: "Paid", hue: "confirmed" } },
  { id: "4", artist: "Ólafur Arnalds", name: "Autumn Tour", venue: "Cirkus", date: "2026-10-14", cap: "1,650", status: { label: "Suggested", hue: "suggested" }, settlement: { label: "Draft", hue: "draft" } },
  { id: "5", artist: "Floating Points", name: "Late Night", venue: "Trädgården", date: "2026-10-25", cap: "2,000", status: { label: "Concluded", hue: "concluded" }, settlement: { label: "Paid", hue: "confirmed" } },
];

const EVENT_COLUMNS: DataTableColumn<EventRow>[] = [
  { header: "Event / Artist", width: "2.4fr", render: (row) => (<span style={{ minWidth: 0 }}><span style={primary}>{row.artist}</span><span style={sub}>{row.name}</span></span>) },
  { header: "Venue", width: "1.5fr", render: (row) => <span style={{ color: "var(--muted)", fontSize: 13 }}>{row.venue}</span> },
  { header: "Date", width: "1fr", render: (row) => <span style={{ ...mono, color: "var(--text)" }}>{row.date}</span> },
  { header: "Cap", width: ".8fr", align: "right", render: (row) => <span style={{ ...mono, color: "var(--muted)" }}>{row.cap}</span> },
  { header: "Status", width: "1.2fr", render: (row) => <Badge status={row.status.hue} dot>{row.status.label}</Badge> },
  { header: "Settlement", width: "1fr", render: (row) => <Badge status={row.settlement.hue} dot>{row.settlement.label}</Badge> },
];

export const Events: Story = {
  render: () => (
    <DataTable
      columns={EVENT_COLUMNS}
      rows={EVENTS}
      getRowKey={(row) => row.id}
      onRowClick={() => {}}
      pagination={{ mode: "pages", pageSize: 2 }}
    />
  ),
};

/* ======================= Bills & Invoices ======================= */
interface BillRow {
  id: string; party: string; event: string; ref: string; category: string; due: string; amount: string;
  status: { label: string; hue: Status };
}

const BILLS: BillRow[] = [
  { id: "1", party: "Nils Frahm", event: "Piano Day", ref: "INV-2026-041", category: "Artist fee", due: "2026-09-27", amount: "€3,000", status: { label: "Sent", hue: "task" } },
  { id: "2", party: "Södra Teatern", event: "Södra Sessions", ref: "INV-2026-039", category: "Venue rental", due: "2026-09-12", amount: "€1,000", status: { label: "Paid", hue: "confirmed" } },
  { id: "3", party: "Ljud & Bild AB", event: "Immunity Live", ref: "INV-2026-044", category: "Production", due: "2026-09-30", amount: "€1,480", status: { label: "Overdue", hue: "cancelled" } },
  { id: "4", party: "Grand Hôtel", event: "Autumn Tour", ref: "—", category: "Accommodation", due: "2026-10-10", amount: "€620", status: { label: "Draft", hue: "draft" } },
  { id: "5", party: "Floating Points", event: "Late Night", ref: "INV-2026-051", category: "Artist fee", due: "2026-11-01", amount: "€4,200", status: { label: "Sent", hue: "task" } },
  { id: "6", party: "SpeedCatering", event: "Piano Day", ref: "INV-2026-052", category: "Catering", due: "2026-09-24", amount: "€540", status: { label: "Paid", hue: "confirmed" } },
];

const BILL_COLUMNS: DataTableColumn<BillRow>[] = [
  { header: "Party", width: "1.6fr", render: (row) => <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text)" }}>{row.party}</span> },
  { header: "Event / Reference", width: "1.6fr", render: (row) => (<span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 12.5, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.event}</span><span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{row.ref}</span></span>) },
  { header: "Category", width: "1fr", render: (row) => <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{row.category}</span> },
  { header: "Due", width: "1fr", render: (row) => <span style={{ ...mono, color: "var(--text)" }}>{row.due}</span> },
  { header: "Amount", width: "0.9fr", align: "right", render: (row) => <span style={{ ...mono, color: "var(--text)" }}>{row.amount}</span> },
  { header: "Status", width: "0.8fr", render: (row) => <Badge status={row.status.hue} dot>{row.status.label}</Badge> },
];

export const BillsAndInvoices: Story = {
  render: () => (
    <DataTable
      columns={BILL_COLUMNS}
      rows={BILLS}
      getRowKey={(row) => row.id}
      pagination={{ mode: "load-more", pageSize: 3 }}
    />
  ),
};

/** Skeleton loading state — shimmering rows matching the column layout. */
export const Loading: Story = {
  render: () => (
    <DataTable columns={EVENT_COLUMNS} rows={[]} getRowKey={(row: EventRow) => row.id} loading skeletonRows={5} />
  ),
};
