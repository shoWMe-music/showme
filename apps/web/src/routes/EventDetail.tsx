import {
  type getApiV1EventsId,
  type getApiV1EventsIdBudgets,
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdRiders,
  type getApiV1EventsIdSchedule,
  type getApiV1EventsIdSettlements,
  getGetApiV1EventsIdQueryKey,
  useGetApiV1EventsId,
  useGetApiV1EventsIdBudgets,
  useGetApiV1EventsIdDeals,
  useGetApiV1EventsIdMessages,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdRiders,
  useGetApiV1EventsIdSchedule,
  useGetApiV1EventsIdSettlements,
  usePatchApiV1EventsId,
} from "@showme/api-client";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Select,
  type Status,
  Toggle,
} from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
  AgreementView,
  BudgetPlanner,
  CommentThread,
  type CostRow,
  type CrewMember,
  type DetailsPerformer,
  type DetailsRider,
  type DetailsScheduleEntry,
  EventDetailsTab,
  type EventExtras,
  EventHistoryTab,
  EventTeamCrewTab,
  EventTodoTab,
  type ScheduleEntry,
  type SettlementLine,
  type SettlementStep,
  SettlementStepper,
  type ThreadComment,
  type TicketTypeRow,
  type Transfer,
  WhoOwesWhomBoard,
} from "../components";
import { EventCollaboratorInviteModal } from "../components/EventCollaboratorInviteModal";
import { type EventTab, EventTabsBar, STATUS_STAGE_INDEX, StageRail } from "../components/eventUi";
import { ErrorState, LoadingState } from "../components/states";
import { formatDate, formatMoney } from "../lib/format";
import { apiStatusToDisplay } from "../lib/status";

type EventDetailData = Awaited<ReturnType<typeof getApiV1EventsId>>;
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];
type Deal = Awaited<ReturnType<typeof getApiV1EventsIdDeals>>[number];
type Budget = Awaited<ReturnType<typeof getApiV1EventsIdBudgets>>[number];
type Settlements = Awaited<ReturnType<typeof getApiV1EventsIdSettlements>>;
type ScheduleItem = Awaited<ReturnType<typeof getApiV1EventsIdSchedule>>[number];
type Rider = Awaited<ReturnType<typeof getApiV1EventsIdRiders>>[number];

/** Map the API event status onto the display four-stop progression. */
function statusLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** A participant's display name — real profile name, else its role tag. */
function participantName(participant: Participant): string {
  return participant.name ?? participant.performerTag ?? statusLabel(participant.role);
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function EventDetail() {
  const { eventId } = useParams({ from: "/events/$eventId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("details");
  const [displayCurrency, setDisplayCurrency] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: event, isPending, isError, error } = useGetApiV1EventsId(eventId);
  const participants = useGetApiV1EventsIdParticipants(eventId);
  const patchEvent = usePatchApiV1EventsId({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(eventId) }),
    },
  });

  if (isPending) return <LoadingState label="Loading event" />;
  if (isError) return <ErrorState error={error} title="Couldn't load this event" />;

  const display = apiStatusToDisplay(event.status);
  const currency = displayCurrency ?? event.baseCurrency;
  const roster = participants.data ?? [];
  const canEdit = event.holdAutoPromote !== undefined; // operator-only fields present

  // The one admin-grade permission set the web app can name. There is no route to
  // list or create permission sets, so the only bundle it can offer a collaborator
  // is one already standing on this event — the HOST's, which is `operator_full`.
  // `permissionSetId` is present on the row only for a caller who may manage the
  // roster (`serializeParticipant`), so an absent id correctly hides the option.
  const hostPermissionSetId =
    roster.find((party) => party.role === "host")?.permissionSetId ?? null;

  const performerParty =
    roster.find((party) => party.role === "performer") ??
    roster.find((party) => party.role === "support");
  const hostParty =
    roster.find((party) => party.role === "host") ??
    roster.find((party) => party.role === "co_host");
  const performerName = performerParty ? participantName(performerParty) : event.title;
  const venueLabel = event.venueName ?? "Venue";
  const operatorName = hostParty ? participantName(hostParty) : "—";

  const crew: CrewMember[] = roster
    .filter((party) => party.role === "crew" || party.role === "crew_lead")
    .map((party) => {
      const name = participantName(party);
      return { id: party.id, name, initials: initials(name), role: statusLabel(party.role) };
    });

  const stageIndex = STATUS_STAGE_INDEX[event.status] ?? 0;

  const tabs: EventTab[] = [
    { key: "todo", label: "To Do" },
    { key: "budget", label: "Budget Planner" },
    { key: "details", label: "Event Details" },
    { key: "agreement", label: "Agreement" },
    { key: "crew", label: "Team / Crew" },
    { key: "settlement", label: "Settlement" },
    { key: "messages", label: "Messages" },
    { key: "collaborators", label: "Collaborators" },
    { key: "history", label: "Event History" },
  ];

  const saveExtras = (next: EventExtras) => {
    patchEvent.mutate({ id: eventId, data: { extras: next, expectedVersion: event.version } });
  };
  const togglePublished = () => {
    patchEvent.mutate({
      id: eventId,
      data: { published: !event.published, expectedVersion: event.version },
    });
  };

  const currencyOptions = Array.from(new Set([event.baseCurrency, "EUR", "USD", "GBP"]));

  return (
    <>
      {/* Breadcrumb + bell */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <Icon name="calendar" size={15} />
          <button
            type="button"
            onClick={() => navigate({ to: "/events" })}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Events
          </button>
          <span style={{ color: "var(--dim)" }}>/</span>
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{event.title}</span>
        </div>
      </div>

      {/* Title + controls */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 26,
                letterSpacing: "-.02em",
                margin: 0,
                color: "var(--text)",
              }}
            >
              {event.title}
            </h1>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: "var(--dim)",
                letterSpacing: ".04em",
              }}
            >
              {shortCode(event.id)}
            </span>
            <Badge status={display.status} dot>
              {display.label}
            </Badge>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              color: "var(--muted)",
              fontSize: 13.5,
              marginTop: 8,
              flexWrap: "wrap",
            }}
          >
            <IdentityChip initials={initials(performerName)} label={performerName} tone="brand" />
            <span style={{ color: "var(--dim)" }}>·</span>
            <IdentityChip initials={initials(venueLabel)} label={venueLabel} tone="amber" />
            <span style={{ color: "var(--dim)" }}>·</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {event.eventDate
                ? formatDate(event.eventDate, { day: "2-digit", month: "short" })
                : "—"}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name={event.published ? "eye" : "eye-off"} size={16} />
            <Toggle
              checked={event.published}
              onChange={canEdit ? togglePublished : undefined}
              label={event.published ? "Published" : "Unpublished"}
            />
          </span>
          <div style={{ width: 116 }}>
            <Select
              value={currency}
              onChange={(value) => setDisplayCurrency(value)}
              options={currencyOptions}
              aria-label="Display currency"
            />
          </div>
          {canEdit && (
            <Button
              variant="secondary"
              leftIcon={<Icon name="user" size={14} />}
              onClick={() => setInviteOpen(true)}
            >
              Invite Collaborator
            </Button>
          )}
          <Button
            variant="secondary"
            leftIcon={<Icon name="share" size={14} />}
            onClick={() => window.print()}
          >
            Share &amp; Export
          </Button>
        </div>
      </div>

      <StageRail currentIndex={stageIndex} />
      <EventTabsBar tabs={tabs} value={tab} onChange={setTab} />

      {tab === "todo" && <EventTodoTab eventId={eventId} />}
      {tab === "budget" && <BudgetTab eventId={eventId} currency={currency} />}
      {tab === "details" && (
        <DetailsTab
          event={event}
          statusLabel={display.label}
          operatorName={operatorName}
          performers={performersFrom(roster, event)}
          currency={currency}
          canEdit={canEdit}
          onSaveExtras={saveExtras}
        />
      )}
      {tab === "agreement" && (
        <AgreementTab
          event={event}
          currency={currency}
          performer={performerParty}
          operatorName={operatorName}
          venueLabel={venueLabel}
        />
      )}
      {tab === "crew" && <EventTeamCrewTab crew={crew} />}
      {tab === "settlement" && (
        <SettlementTab eventId={eventId} currency={currency} roster={roster} />
      )}
      {tab === "messages" && <MessagesTab eventId={eventId} roster={roster} />}
      {tab === "collaborators" && (
        <CollaboratorsTab
          roster={roster}
          isPending={participants.isPending}
          isError={participants.isError}
          error={participants.error}
          onInvite={canEdit ? () => setInviteOpen(true) : undefined}
        />
      )}
      {tab === "history" && <EventHistoryTab eventId={eventId} />}

      <EventCollaboratorInviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        eventId={eventId}
        eventTitle={event.title}
        fullControlPermissionSetId={hostPermissionSetId}
      />
    </>
  );
}

function shortCode(id: string): string {
  return `EVT-${id
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 6)
    .toUpperCase()}`;
}

function IdentityChip({
  initials: text,
  label,
  tone,
}: {
  initials: string;
  label: string;
  tone: "brand" | "amber";
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Avatar initials={text} tone={tone} shape="square" size={18} />
      {label}
    </span>
  );
}

/** Map the roster's performer/support participants to the Details performer rows. */
function performersFrom(roster: Participant[], event: EventDetailData): DetailsPerformer[] {
  const sub = [
    event.venueName,
    event.capacity != null ? `${event.capacity.toLocaleString("en-US")} cap.` : null,
  ]
    .filter(Boolean)
    .join(" — ");
  return roster
    .filter((party) => party.role === "performer" || party.role === "support")
    .map((party) => {
      const name = participantName(party);
      return {
        id: party.id,
        name,
        initials: initials(name),
        sub,
        connected: party.status === "confirmed" || party.status === "accepted",
      };
    });
}

/** Details tab: fetches schedule / deals / riders and composes the section stack. */
function DetailsTab({
  event,
  statusLabel: statusText,
  operatorName,
  performers,
  currency,
  canEdit,
  onSaveExtras,
}: {
  event: EventDetailData;
  statusLabel: string;
  operatorName: string;
  performers: DetailsPerformer[];
  currency: string;
  canEdit: boolean;
  onSaveExtras: (next: EventExtras) => void;
}) {
  const schedule = useGetApiV1EventsIdSchedule(event.id);
  const deals = useGetApiV1EventsIdDeals(event.id);
  const riders = useGetApiV1EventsIdRiders(event.id);

  const scheduleEntries: DetailsScheduleEntry[] = toScheduleEntries(schedule.data ?? []);
  const riderRows: DetailsRider[] = (riders.data ?? []).map((rider: Rider) => ({
    id: rider.id,
    name: rider.name,
    type: statusLabel(rider.type),
  }));
  const deal = firstDealSummary(deals.data ?? [], currency);

  return (
    <EventDetailsTab
      event={{
        id: event.id,
        title: event.title,
        status: event.status,
        eventDate: event.eventDate,
        doorTime: event.doorTime,
        startTime: event.startTime,
        endTime: event.endTime,
        curfew: event.curfew,
        venueName: event.venueName,
        capacity: event.capacity,
        stageId: event.stageId,
        version: event.version,
        extras: event.extras as EventExtras | null | undefined,
      }}
      statusLabel={statusText}
      operatorName={operatorName}
      performers={performers}
      riders={riderRows}
      schedule={scheduleEntries}
      deal={deal}
      currency={currency}
      canEdit={canEdit}
      onSaveExtras={onSaveExtras}
    />
  );
}

function firstDealSummary(deals: Deal[], currency: string) {
  const deal = deals[0];
  if (!deal) return null;
  const costSplit =
    deal.splitBasisPoints != null
      ? `${(deal.splitBasisPoints / 100).toFixed(0)}% split`
      : deal.structure
        ? statusLabel(deal.structure)
        : null;
  return {
    dealTypeLabel: statusLabel(deal.structure ?? deal.type),
    costSplit,
    guarantee: deal.guaranteeAmount
      ? formatMoney(deal.guaranteeAmount, deal.currency ?? currency)
      : null,
  };
}

function AgreementTab({
  event,
  currency,
  performer,
  operatorName,
  venueLabel,
}: {
  event: EventDetailData;
  currency: string;
  performer?: Participant;
  operatorName: string;
  venueLabel: string;
}) {
  const { data, isPending, isError, error } = useGetApiV1EventsIdDeals(event.id);
  const schedule = useGetApiV1EventsIdSchedule(event.id);

  if (isPending) return <LoadingState label="Loading agreement" />;
  if (isError) return <ErrorState error={error} title="Couldn't load the agreement" />;

  const deals = data ?? [];
  if (deals.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="file" />}
        title="No agreement yet"
        description="The deal, its terms and the production schedule will appear here."
      />
    );
  }

  const scheduleEntries = toScheduleEntries(schedule.data ?? []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {deals.map((deal) => (
        <AgreementView
          key={deal.id}
          frozen={deal.agreementStatus === "signed" || deal.agreementStatus === "confirmed"}
          summary={agreementSummary(event, deal, performer, operatorName, venueLabel)}
          dealStructure={dealStructure(deal, currency)}
          schedule={scheduleEntries}
          onExportPdf={() => window.print()}
        />
      ))}
    </div>
  );
}

function agreementSummary(
  event: EventDetailData,
  deal: Deal,
  performer: Participant | undefined,
  operatorName: string,
  venueLabel: string,
) {
  return [
    { label: "Event", value: event.title },
    {
      label: "Date",
      value: formatDate(event.eventDate, { day: "2-digit", month: "short", year: "numeric" }),
    },
    { label: "Performer", value: performer ? participantName(performer) : "—" },
    { label: "Venue", value: venueLabel },
    { label: "Operator", value: operatorName },
    { label: "Deal", value: deal.name },
    { label: "Status", value: apiStatusToDisplay(event.status).label },
  ];
}

function dealStructure(deal: Deal, currency: string) {
  const rows = [{ label: "Deal type", value: statusLabel(deal.type) }];
  if (deal.structure) rows.push({ label: "Structure", value: statusLabel(deal.structure) });
  if (deal.guaranteeAmount) {
    rows.push({
      label: "Guarantee",
      value: formatMoney(deal.guaranteeAmount, deal.currency ?? currency),
    });
  }
  if (deal.advanceAmount) {
    rows.push({
      label: "Advance",
      value: formatMoney(deal.advanceAmount, deal.currency ?? currency),
    });
  }
  if (deal.splitBasisPoints != null) {
    rows.push({ label: "Split", value: `${(deal.splitBasisPoints / 100).toFixed(0)}%` });
  }
  rows.push({ label: "Payment timing", value: statusLabel(deal.paymentTiming) });
  rows.push({ label: "Agreement", value: statusLabel(deal.agreementStatus) });
  rows.push({ label: "Parties", value: String(deal.parties.length) });
  return rows;
}

function toScheduleEntries(items: ScheduleItem[]): ScheduleEntry[] {
  return items
    .slice()
    .sort((a, b) => (a.localDateTime ?? "").localeCompare(b.localDateTime ?? ""))
    .map((item) => ({
      time: item.localDateTime
        ? new Date(item.localDateTime).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
      label: item.label,
    }));
}

/** Seed the Budget Planner from the event's budget lines, then edit locally. */
function BudgetTab({ eventId, currency }: { eventId: string; currency: string }) {
  const { data, isPending, isError, error } = useGetApiV1EventsIdBudgets(eventId);

  if (isPending) return <LoadingState label="Loading budget" />;
  if (isError) return <ErrorState error={error} title="Couldn't load the budget" />;

  const budgets = data ?? [];
  const lines = budgets.flatMap((budget) => budget.lines);
  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="file" />}
        title="No budget yet"
        description="Ticket revenue, costs and cash movements will appear here."
      />
    );
  }

  return <BudgetEditor budgets={budgets} currency={currency} />;
}

function BudgetEditor({ budgets, currency }: { budgets: Budget[]; currency: string }) {
  const lines = budgets.flatMap((budget) => budget.lines);
  const symbol = currencySymbol(currency);
  const money = (major: number) =>
    new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(major);

  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[]>(() =>
    lines
      .filter((line) => line.kind === "revenue")
      .map((line) => ({
        id: line.id,
        name: line.label,
        price: (Number(line.amount) / 100).toString(),
        quantity: "1",
      })),
  );
  const [capacity, setCapacity] = useState("0");
  const [avgBarSpend, setAvgBarSpend] = useState("0");
  const [costs, setCosts] = useState<CostRow[]>(() =>
    lines
      .filter((line) => line.kind === "cost")
      .map((line) => ({
        key: line.id,
        label: line.label,
        value: (Number(line.amount) / 100).toString(),
      })),
  );

  const num = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const ticketRevenue = ticketTypes.reduce(
    (total, ticket) => total + num(ticket.price) * num(ticket.quantity),
    0,
  );
  const barRevenue = num(capacity) * num(avgBarSpend);
  const totalRevenue = ticketRevenue + barRevenue;
  const totalCosts = costs.reduce((total, cost) => total + num(cost.value), 0);
  const profit = totalRevenue - totalCosts;
  const avgTicketPrice =
    ticketTypes.length > 0
      ? ticketTypes.reduce((total, ticket) => total + num(ticket.price), 0) / ticketTypes.length
      : 0;
  const breakEven = avgTicketPrice > 0 ? Math.ceil(totalCosts / avgTicketPrice) : 0;

  return (
    <BudgetPlanner
      currencySymbol={symbol}
      kpis={[
        { label: "Total revenue", value: money(totalRevenue), tone: "green" },
        { label: "Total costs", value: money(totalCosts), tone: "red" },
        { label: "Profit / loss", value: money(profit), tone: profit < 0 ? "red" : "green" },
        { label: "Break-even tickets", value: breakEven, tone: "amber" },
      ]}
      ticketTypes={ticketTypes}
      ticketRevenueTotal={money(ticketRevenue)}
      capacity={capacity}
      avgBarSpend={avgBarSpend}
      barRevenue={money(barRevenue)}
      costs={costs}
      onTicketChange={(id, field, value) =>
        setTicketTypes((rows) =>
          rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
        )
      }
      onAddTicketType={() =>
        setTicketTypes((rows) => [
          ...rows,
          { id: `new-${rows.length}-${Date.now()}`, name: "", price: "0", quantity: "0" },
        ])
      }
      onRemoveTicketType={(id) => setTicketTypes((rows) => rows.filter((row) => row.id !== id))}
      onCapacityChange={setCapacity}
      onAvgBarSpendChange={setAvgBarSpend}
      onCostChange={(key, value) =>
        setCosts((rows) => rows.map((row) => (row.key === key ? { ...row, value } : row)))
      }
    />
  );
}

function SettlementTab({
  eventId,
  currency,
  roster,
}: {
  eventId: string;
  currency: string;
  roster: Participant[];
}) {
  const { data, isPending, isError, error } = useGetApiV1EventsIdSettlements(eventId);

  if (isPending) return <LoadingState label="Loading settlement" />;
  if (isError) return <ErrorState error={error} title="Couldn't load the settlement" />;

  const settlements = data?.settlements ?? [];
  const transfers = data?.transfers ?? [];

  if (settlements.length === 0 && transfers.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="receipt" />}
        title="Nothing settled yet"
        description="Per-participant entitlements and transfers appear once settlement runs."
      />
    );
  }

  const nameFor = (participantId: string | null | undefined): string => {
    const match = roster.find((party) => party.id === participantId);
    return match ? participantName(match) : "Participant";
  };

  const lines: SettlementLine[] = settlements
    .filter((settlement) => settlement.computed)
    .map((settlement) => {
      const computed = settlement.computed as NonNullable<typeof settlement.computed>;
      const netValue = Number(computed.net);
      const name = nameFor(settlement.participantId);
      return {
        id: settlement.id,
        party: name,
        initials: initials(name),
        owed: formatMoney(computed.entitlement, currency),
        collected: formatMoney(computed.collected, currency),
        paid: formatMoney(computed.paid, currency),
        net: formatMoney(computed.net, currency),
        netTone: netValue < 0 ? "negative" : netValue > 0 ? "positive" : "neutral",
      };
    });

  const transferRows: Transfer[] = transfers.map((transfer, index) => ({
    id: transfer.id ?? String(index),
    from: nameFor(transfer.fromParticipantId),
    to: nameFor(transfer.toParticipantId),
    amount: formatMoney(transfer.amount, currency),
    state: transferState(transfer.state),
  }));

  const netSum = settlements.reduce(
    (total, settlement) => total + (settlement.computed ? Number(settlement.computed.net) : 0),
    0,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SettlementStepper steps={settlementSteps(settlements)} />
      </Card>
      <WhoOwesWhomBoard
        participants={lines}
        transfers={transferRows}
        balanced={Math.abs(netSum) < 1}
      />
    </div>
  );
}

function transferState(raw?: string): Transfer["state"] {
  if (raw === "paid") return "paid";
  if (raw === "handled" || raw === "concluded") return "handled";
  return "owed";
}

function settlementSteps(settlements: Settlements["settlements"]): SettlementStep[] {
  const labels = ["Open", "Pending review", "Finalized", "Paid"];
  const rank: Record<string, number> = {
    open: 0,
    draft: 0,
    pending: 1,
    pending_review: 1,
    review: 1,
    finalized: 2,
    revised: 2,
    partly_paid: 3,
    paid: 3,
    concluded: 3,
  };
  const active = settlements.reduce(
    (lowest, settlement) => {
      const value = rank[settlement.status] ?? 0;
      return Math.min(lowest, value);
    },
    settlements.length > 0 ? 3 : 0,
  );
  return labels.map((label, index) => ({
    label,
    state: index < active ? "done" : index === active ? "active" : "pending",
  }));
}

function CollaboratorsTab({
  roster,
  isPending,
  isError,
  error,
  onInvite,
}: {
  roster: Participant[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** Absent when this viewer may not manage the roster — then the tab is read-only. */
  onInvite?: () => void;
}) {
  if (isPending) return <LoadingState label="Loading collaborators" />;
  if (isError) return <ErrorState error={error} title="Couldn't load collaborators" />;

  // The prototype puts an "+ Invite" beside the tab heading as well as in the
  // header — the same action, reached from where you notice you need it. It opens
  // the SAME modal (one flow, one component) rather than a second divergent one.
  const heading = onInvite ? (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 14,
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
        Profiles and parties connected to this event
      </span>
      <Button variant="primary" leftIcon={<Icon name="plus" size={14} />} onClick={onInvite}>
        Invite
      </Button>
    </div>
  ) : null;

  if (roster.length === 0) {
    return (
      <>
        {heading}
        <EmptyState
          icon={<Icon name="users" />}
          title="No collaborators yet"
          description="Profiles and parties connected to this event will appear here."
        />
      </>
    );
  }

  const roleTone = (role: string) => {
    if (role === "performer" || role === "support") return "brand" as const;
    if (role === "host" || role === "co_host") return "green" as const;
    if (role === "agent") return "purple" as const;
    return "blue" as const;
  };

  // Laid out like the Team screen's member grid (`routes/Team.tsx`): each person
  // is their own card on the page background, rather than rows inside one big
  // surface. A card inside a card reads as a container the eye has to discount,
  // and the two screens show the same thing — people on a roster — so they should
  // look the same. Geometry is deliberately identical: `minmax(260px, 1fr)` and a
  // 14px gutter.
  return (
    <>
      {heading}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {roster.map((party) => {
          const name = participantName(party);
          const state = apiStatusToDisplay(party.status);
          return (
            <Card
              key={party.id}
              padding="md"
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <Avatar initials={initials(name)} tone={roleTone(party.role)} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    {statusLabel(party.role)}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Badge status={badgeStatusForParticipant(party.status)} dot>
                  {state.label}
                </Badge>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function badgeStatusForParticipant(raw: string): Status {
  if (raw === "confirmed" || raw === "active" || raw === "accepted") return "confirmed";
  if (raw === "invited" || raw === "pending") return "pending";
  if (raw === "declined" || raw === "removed") return "cancelled";
  return "draft";
}

function MessagesTab({ eventId, roster }: { eventId: string; roster: Participant[] }) {
  const { data, isPending, isError, error } = useGetApiV1EventsIdMessages(eventId);

  if (isPending) return <LoadingState label="Loading messages" />;
  if (isError) return <ErrorState error={error} title="Couldn't load messages" />;

  const messages = data ?? [];
  if (messages.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="mail" />}
        title="No messages yet"
        description="The per-event thread will appear here."
      />
    );
  }

  const nameFor = (participantId: string | null): string => {
    const match = roster.find((party) => party.id === participantId);
    return match ? participantName(match) : "Member";
  };

  const comments: ThreadComment[] = messages.map((message) => {
    const author = nameFor(message.senderParticipantId);
    return {
      id: message.id,
      author,
      initials: initials(author),
      time: relativeTime(message.createdAt),
      body: message.body,
    };
  });

  return <CommentThread comments={comments} eyebrow="Messages" readOnly />;
}

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}
