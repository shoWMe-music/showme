import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  Icon,
  KeyValueRow,
  SectionHeader,
  StatCard,
  STATUS_LABEL,
  type TabItem,
  Tabs,
} from "@showme/design-system";
import { eur, eventById } from "../data/mock";

const TABS: TabItem[] = [
  { key: "todo", label: "To Do" },
  { key: "budget", label: "Budget" },
  { key: "details", label: "Details" },
  { key: "agreement", label: "Agreement" },
  { key: "settlement", label: "Settlement" },
];

const POS = "#6FC97A";

export function EventDetail() {
  const { eventId } = useParams({ from: "/events/$eventId" });
  const navigate = useNavigate();
  const [tab, setTab] = useState("details");
  const ev = eventById(eventId);

  if (!ev) {
    return (
      <>
        <SectionHeader eyebrow="404" title="Event not found" subtitle={`No event with id ${eventId}.`} />
        <Button variant="secondary" leftIcon={<Icon name="arrow-right" />} onClick={() => navigate({ to: "/events" })}>
          Back to events
        </Button>
      </>
    );
  }

  // Mock settlement figures derived from the event.
  const ticketPrice = 25;
  const ticketRevenue = ev.ticketsSold * ticketPrice;
  const barRevenue = Math.round(ticketRevenue * 0.2);
  const production = 1500;
  const rental = 1000;
  const pool = ticketRevenue + barRevenue - production;
  const performer = ev.guarantee;
  const residual = pool - performer - rental;

  return (
    <>
      <SectionHeader
        eyebrow={ev.id}
        title={ev.artist}
        subtitle={`${ev.venue} · ${ev.city} · ${new Date(ev.date).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}`}
        actions={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Badge status={ev.status} dot>
              {STATUS_LABEL[ev.status]}
            </Badge>
            <Button variant="secondary" onClick={() => navigate({ to: "/events" })}>
              All events
            </Button>
          </div>
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "details" && (
        <div className="panelgrid">
          <Card padding="lg">
            <KeyValueRow label="Venue" value={ev.venue} />
            <KeyValueRow label="City" value={ev.city} />
            <KeyValueRow label="Capacity" value={ev.capacity.toLocaleString()} mono />
            <KeyValueRow label="Tickets sold" value={ev.ticketsSold.toLocaleString()} mono />
            <KeyValueRow label="Ticketing" value="Eventbrite" />
          </Card>
          <Card padding="lg">
            <KeyValueRow label="Deal type" value="Guarantee vs Door" />
            <KeyValueRow label="Guarantee" value={eur(ev.guarantee)} mono />
            <KeyValueRow label="Split (A / P / V)" value="70 / 15 / 15" mono />
            <KeyValueRow label="Venue rental" value={eur(rental)} mono />
            <KeyValueRow label="Operator" value="shoWMe (promoter)" />
          </Card>
        </div>
      )}

      {tab === "settlement" && (
        <Card padding="lg">
          <KeyValueRow label="Ticket sales" value={eur(ticketRevenue)} mono />
          <KeyValueRow label="Bar / F&B" value={eur(barRevenue)} mono />
          <KeyValueRow label="Production costs" value={`− ${eur(production)}`} mono />
          <KeyValueRow label="Pool" value={eur(pool)} mono total />
          <KeyValueRow label="Performer (guarantee)" value={eur(performer)} mono />
          <KeyValueRow label="Venue (rental)" value={eur(rental)} mono />
          <KeyValueRow label="Your retained share" value={eur(residual)} mono total valueColor={POS} />
        </Card>
      )}

      {tab === "budget" && (
        <div className="grid-stats">
          <StatCard label="Total revenue" value={eur(ticketRevenue + barRevenue)} />
          <StatCard label="Total costs" value={eur(production + rental)} />
          <StatCard label="Projected profit" value={eur(residual)} hint="operator residual" />
          <StatCard label="Break-even" value={`${Math.ceil((production + rental + performer) / ticketPrice)} tix`} />
        </div>
      )}

      {tab === "agreement" && (
        <Card padding="lg">
          <KeyValueRow label="Performer" value={<Badge status="confirmed" dot>Confirmed</Badge>} />
          <KeyValueRow label="Promoter" value={<Badge status="confirmed" dot>Confirmed</Badge>} />
          <KeyValueRow label="Venue" value={<Badge status="pending" dot>Reviewing</Badge>} />
        </Card>
      )}

      {tab === "todo" && (
        <Card padding="lg">
          <KeyValueRow label="Send offer to management" value={<Icon name="check" />} />
          <KeyValueRow label="Confirm venue hold" value={<Icon name="check" />} />
          <KeyValueRow label="Finalize settlement" value={<span className="muted">open</span>} />
          <KeyValueRow label="Upload signed rider" value={<span className="muted">open</span>} />
        </Card>
      )}
    </>
  );
}
