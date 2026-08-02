import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Icon,
  SectionHeader,
  StatCard,
  STATUS_LABEL,
} from "@showme/design-system";
import { type EventRow, eur, events } from "../data/mock";

const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export function Dashboard() {
  const navigate = useNavigate();

  const confirmed = events.filter((e) => e.status === "confirmed").length;
  const awaiting = events.filter((e) => e.status === "pending" || e.status === "suggested").length;
  const holds = events.filter((e) => e.status === "hold").length;
  const committed = events.reduce((s, e) => s + (e.status === "confirmed" ? e.guarantee : 0), 0);
  const recent = events.slice(0, 5);

  const columns: DataTableColumn<EventRow>[] = [
    {
      header: "Event / Artist",
      width: "2fr",
      render: (r) => (
        <div>
          <b>{r.artist}</b>
          <div className="muted" style={{ fontSize: 12 }}>
            {r.venue} · {r.city}
          </div>
        </div>
      ),
    },
    { header: "Date", width: "1fr", render: (r) => shortDate(r.date) },
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
        eyebrow="Overview"
        title="Dashboard"
        accent="at a glance"
        subtitle="Your live events, requests and money — one operator view."
      />

      <div className="grid-stats">
        <StatCard label="Confirmed events" value={confirmed} icon={<Icon name="check" />} />
        <StatCard label="Awaiting response" value={awaiting} hint="offers + suggestions" icon={<Icon name="mail" />} />
        <StatCard label="On hold" value={holds} icon={<Icon name="clock" />} />
        <StatCard label="Guarantees committed" value={eur(committed)} hint="confirmed only" icon={<Icon name="file" />} />
      </div>

      <SectionHeader
        eyebrow="Recent"
        title="Latest events"
        actions={
          <Button variant="ghost" rightIcon={<Icon name="arrow-right" />} onClick={() => navigate({ to: "/events" })}>
            View all
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={recent}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate({ to: "/events/$eventId", params: { eventId: r.id } })}
      />
    </>
  );
}
