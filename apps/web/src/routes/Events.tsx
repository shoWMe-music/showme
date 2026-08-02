import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Icon,
  SectionHeader,
  STATUS_LABEL,
  type TabItem,
  Tabs,
} from "@showme/design-system";
import { type EventRow, eur, events } from "../data/mock";

const TABS: TabItem[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "hold", label: "On hold" },
  { key: "confirmed", label: "Confirmed" },
  { key: "concluded", label: "Concluded" },
  { key: "draft", label: "Draft" },
];

const longDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function Events() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");

  const rows = events.filter((e) =>
    tab === "all"
      ? true
      : tab === "pending"
        ? e.status === "pending" || e.status === "suggested"
        : e.status === tab,
  );

  const columns: DataTableColumn<EventRow>[] = [
    {
      header: "Event / Artist",
      width: "2.2fr",
      render: (r) => (
        <div>
          <b>{r.artist}</b>
          <div className="muted" style={{ fontSize: 12 }}>
            {r.id}
          </div>
        </div>
      ),
    },
    {
      header: "Venue",
      width: "1.6fr",
      render: (r) => (
        <div>
          {r.venue}
          <div className="muted" style={{ fontSize: 12 }}>
            {r.city}
          </div>
        </div>
      ),
    },
    { header: "Date", width: "1.2fr", render: (r) => longDate(r.date) },
    {
      header: "Status",
      width: "1fr",
      render: (r) => (
        <Badge status={r.status} dot>
          {STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    { header: "Guarantee", width: "1fr", align: "right", render: (r) => eur(r.guarantee) },
  ];

  return (
    <>
      <SectionHeader
        eyebrow="All events"
        title="Events"
        subtitle="Every show you operate or take part in — each party sees only its own slice."
        actions={
          <Button variant="primary" leftIcon={<Icon name="plus" />}>
            New event
          </Button>
        }
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate({ to: "/events/$eventId", params: { eventId: r.id } })}
      />
    </>
  );
}
