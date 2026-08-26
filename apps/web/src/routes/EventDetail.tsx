import {
  type getApiV1EventsId,
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdInvitations,
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdRiders,
  type getApiV1EventsIdSchedule,
  getGetApiV1EventsIdInvitationsQueryKey,
  getGetApiV1EventsIdQueryKey,
  useGetApiV1EventsId,
  useGetApiV1EventsIdDeals,
  useGetApiV1EventsIdInvitations,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdRiders,
  useGetApiV1EventsIdSchedule,
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
} from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BudgetPlanner,
  type CrewMember,
  type DetailsPerformer,
  type DetailsRider,
  type DetailsScheduleEntry,
  EventDetailsTab,
  type EventExtras,
  EventHistoryTab,
  EventMessagesTab,
  EventTodoTab,
  type ScheduleEntry,
} from "../components";
import { BudgetCustomFieldModal, type CustomFieldKind } from "../components/BudgetCustomFieldModal";
import { BudgetTemplateDialogs } from "../components/BudgetTemplateDialogs";
import { EventAgreementTab } from "../components/EventAgreementTab";
import { EventCollaboratorInviteModal } from "../components/EventCollaboratorInviteModal";
import { EventCrewPanel } from "../components/EventCrewPanel";
import { EventSettlementTab } from "../components/EventSettlementTab";
import { EventStatusControl } from "../components/EventStatusControl";
import { budgetPlannerViewFrom } from "../components/budgetPlannerView";
import {
  type EventTab,
  EventTabsBar,
  Eyebrow,
  STATUS_STAGE_INDEX,
  StageRail,
} from "../components/eventUi";
import { ErrorState, LoadingState } from "../components/states";
import { useBudgetEditor } from "../components/useBudgetEditor";
import { useBudgetSeed } from "../components/useBudgetSeed";
import { useBudgetToolbar } from "../components/useBudgetToolbar";
import { formatDate, formatMoney } from "../lib/format";
import { apiStatusToDisplay } from "../lib/status";

type EventDetailData = Awaited<ReturnType<typeof getApiV1EventsId>>;
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];
type EventInvitation = Awaited<ReturnType<typeof getApiV1EventsIdInvitations>>[number];
type Deal = Awaited<ReturnType<typeof getApiV1EventsIdDeals>>[number];
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

export function EventDetail() {
  const { eventId } = useParams({ from: "/events/$eventId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("details");
  const [displayCurrency, setDisplayCurrency] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Which role the invite modal opens on. The header's button asks the open
  // question; the Team / Crew tab's "+ Add Member" has already answered it.
  const [inviteRole, setInviteRole] = useState<string | undefined>(undefined);
  const openInvite = (role?: string) => {
    setInviteRole(role);
    setInviteOpen(true);
  };

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
  // EVERY act on the bill, not just the headliner: a support act's guarantee is
  // still a performance deal, and the Budget Planner seeds its "Performer fee"
  // from whichever of them the deal actually names as payee.
  //
  // Passed as a joined STRING rather than an array because `roster` is rebuilt
  // on every render: a fresh array would be a new dependency each time and the
  // seed downstream would never settle. The string is stable while the ids are.
  const performerIdsKey = roster
    .filter((party) => party.role === "performer" || party.role === "support")
    .map((party) => party.id)
    .join(",");
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
              onClick={() => openInvite()}
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
      {/* The rail SHOWS where the booking stands; this SETS it. An operator with
          no counterparty — a venue running its own room, or anyone typing in
          bookings they already have — has to be able to move the event
          themselves, and could not (see `useEventStatusEditor`). */}
      {canEdit && (
        <EventStatusControl
          event={{ id: event.id, status: event.status, version: event.version }}
        />
      )}
      <EventTabsBar tabs={tabs} value={tab} onChange={setTab} />

      {tab === "todo" && <EventTodoTab eventId={eventId} />}
      {tab === "budget" && (
        <BudgetTab
          eventId={eventId}
          currency={currency}
          eventTitle={event.title}
          capacity={event.capacity ?? null}
          performerIdsKey={performerIdsKey}
        />
      )}
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
        <EventAgreementTab
          eventId={eventId}
          eventTitle={event.title}
          eventDate={event.eventDate}
          eventStatusLabel={display.label}
          // `?? []` only for an API older than this field (a dev server left
          // running across the change): no capabilities means no action is
          // offered, which is the safe reading, rather than a crash.
          capabilities={event.capabilities ?? []}
          currency={currency}
          baseCurrency={event.baseCurrency}
          venueLabel={venueLabel}
          operatorName={operatorName}
        />
      )}
      {tab === "crew" && (
        <EventCrewPanel
          eventId={eventId}
          crew={crew}
          canManage={canEdit}
          onInviteCrew={() => openInvite("crew")}
        />
      )}
      {tab === "settlement" && (
        <EventSettlementTab
          eventId={eventId}
          currency={event.baseCurrency}
          roster={roster}
          capabilities={event.capabilities ?? []}
        />
      )}
      {tab === "messages" && <MessagesTab eventId={eventId} roster={roster} />}
      {tab === "collaborators" && (
        <CollaboratorsTab
          eventId={eventId}
          roster={roster}
          isPending={participants.isPending}
          isError={participants.isError}
          error={participants.error}
          canManage={canEdit}
          onInvite={canEdit ? () => openInvite() : undefined}
        />
      )}
      {tab === "history" && <EventHistoryTab eventId={eventId} />}

      <EventCollaboratorInviteModal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          // The invitation the operator just sent is the thing they will look
          // for next, so the Collaborators tab must not still be holding the
          // list from before they opened this modal.
          queryClient.invalidateQueries({
            queryKey: getGetApiV1EventsIdInvitationsQueryKey(eventId),
          });
        }}
        eventId={eventId}
        eventTitle={event.title}
        fullControlPermissionSetId={hostPermissionSetId}
        initialRole={inviteRole}
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
        venueProfileId: event.venueProfileId,
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

/**
 * The Budget Planner tab. Reads and WRITES the event's budget lines through
 * `useBudgetEditor` — it used to edit them into local state and discard them,
 * on a budget that on a new event did not exist at all.
 */
function BudgetTab({
  eventId,
  currency,
  eventTitle,
  capacity,
  performerIdsKey,
}: {
  eventId: string;
  currency: string;
  eventTitle: string;
  capacity: number | null;
  /** Comma-joined participant ids — see `performerIdsKey` above. */
  performerIdsKey: string;
}) {
  // What the event already knows, offered into the planner's blank fields — the
  // rest of the app was holding a capacity and a guarantee while this screen
  // showed an empty sheet. A suggestion, never an overwrite (`useBudgetSeed`).
  const seedSources = useMemo(
    () => ({
      capacity,
      performerParticipantIds: performerIdsKey === "" ? [] : performerIdsKey.split(","),
    }),
    [capacity, performerIdsKey],
  );
  const seed = useBudgetSeed(eventId, seedSources);
  const editor = useBudgetEditor(eventId, seed);
  const toolbar = useBudgetToolbar(editor, eventTitle, currency);
  // Which card the "+ Add Field" modal is adding to, or null when it is closed.
  const [customFieldKind, setCustomFieldKind] = useState<CustomFieldKind>(null);

  if (editor.isPending) return <LoadingState label="Loading budget" />;
  if (editor.isError) return <ErrorState error={editor.error} title="Couldn't load the budget" />;

  // Every figure on the screen, derived once. The arithmetic is `@showme/shared`'s
  // and the unit boundary is `budgetPlannerView`'s (CLAUDE.md: business logic is
  // plain, framework-agnostic TS) — this screen picks a currency and renders.
  const view = budgetPlannerViewFrom(editor, currency);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {editor.budgets.length > 1 && (
        <BudgetScopeSwitch
          budgets={editor.budgets}
          selectedBudgetId={editor.selectedBudgetId}
          onSelect={editor.selectBudget}
        />
      )}
      {editor.readOnlyReason && <Eyebrow>{editor.readOnlyReason}</Eyebrow>}
      <BudgetPlanner
        currencySymbol={currencySymbol(currency)}
        kpis={view.kpis}
        results={view.results}
        breakEven={view.breakEven}
        revenueSources={view.revenueSources}
        costBreakdown={view.costBreakdown}
        performingRights={view.performingRights}
        ticketTypes={editor.ticketTiers.map((tier) => ({
          id: tier.id,
          name: tier.name,
          price: tier.price,
          quantity: tier.quantity,
        }))}
        ticketRevenueTotal={view.ticketRevenueTotal}
        capacity={editor.capacity}
        avgBarSpend={editor.averageBarSpend}
        barRevenue={view.barRevenue}
        otherRevenue={editor.otherRevenue}
        costs={editor.costs}
        customRevenue={editor.customRevenue}
        toolbar={toolbar.actions}
        processingPercent={editor.processingPercent}
        processingFlatPerTicket={editor.processingFlatPerTicket}
        onTicketChange={editor.changeTier}
        onAddTicketType={editor.addTier}
        onRemoveTicketType={editor.removeTier}
        onCapacityChange={editor.changeCapacity}
        onAvgBarSpendChange={editor.changeAverageBarSpend}
        onOtherRevenueChange={editor.changeOtherRevenue}
        onCostChange={editor.changeCost}
        onRemoveCost={editor.removeCost}
        onCustomRevenueChange={editor.changeCustomRevenue}
        onRemoveCustomRevenue={editor.removeCustomRevenue}
        onAddCustomField={setCustomFieldKind}
        onProcessingPercentChange={editor.changeProcessingPercent}
        onProcessingFlatPerTicketChange={editor.changeProcessingFlatPerTicket}
      />
      <BudgetCustomFieldModal
        kind={customFieldKind}
        currencySymbol={currencySymbol(currency)}
        onClose={() => setCustomFieldKind(null)}
        onSubmit={(kind, label, amount, type) =>
          kind === "cost"
            ? editor.addCustomCost(label, amount, type)
            : editor.addCustomRevenue(label, amount, type)
        }
      />
      <BudgetTemplateDialogs toolbar={toolbar} />
    </div>
  );
}

/**
 * Which book you are looking at, shown only once there is more than one: an
 * operator's own private budget and the shared ledger a co-hosted event keeps.
 */
function BudgetScopeSwitch({
  budgets,
  selectedBudgetId,
  onSelect,
}: {
  budgets: { id: string; scope: string }[];
  selectedBudgetId: string | null;
  onSelect: (budgetId: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {budgets.map((budget) => (
        <Button
          key={budget.id}
          variant={budget.id === selectedBudgetId ? "primary" : "ghost"}
          onClick={() => onSelect(budget.id)}
        >
          {budget.scope === "shared" ? "Shared ledger" : "My budget"}
        </Button>
      ))}
    </div>
  );
}

function CollaboratorsTab({
  eventId,
  roster,
  isPending,
  isError,
  error,
  canManage,
  onInvite,
}: {
  eventId: string;
  roster: Participant[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** Whether this viewer may manage the roster — only they may read the open invites. */
  canManage: boolean;
  /** Absent when this viewer may not manage the roster — then the tab is read-only. */
  onInvite?: () => void;
}) {
  // The other half of the roster: people who have been ASKED but have not
  // answered. An invitation writes no participant row until it is accepted, so
  // until this list existed an operator who had just invited someone saw a tab
  // that looked exactly as it did before they sent it. Only a roster manager
  // fetches it — it carries the invitees' email addresses.
  const invitations = useGetApiV1EventsIdInvitations(eventId, { query: { enabled: canManage } });
  const pendingInvitations = invitations.data ?? [];

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

  if (roster.length === 0 && pendingInvitations.length === 0) {
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
                  {participantStatusLabel(party.status)}
                </Badge>
              </div>
            </Card>
          );
        })}
        {pendingInvitations.map((invitation) => (
          <PendingInvitationCard key={invitation.id} invitation={invitation} />
        ))}
      </div>
    </>
  );
}

/**
 * Someone who has been asked and has not answered. Deliberately the same card as
 * a real collaborator — they belong on the same roster, they are simply not on
 * it yet — but never dressed as one: the avatar is neutral, the badge says
 * Pending, and the line underneath says plainly that nothing is granted until
 * they accept. Anything less and an operator reads "invited" as "added".
 */
function PendingInvitationCard({ invitation }: { invitation: EventInvitation }) {
  const label = invitation.recipientName ?? invitation.recipientEmail ?? "Invited collaborator";
  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Avatar initials={initials(label)} tone="amber" size={40} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{label}</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {invitation.role ? statusLabel(invitation.role) : "Collaborator"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge status="pending" dot>
          Invite pending
        </Badge>
      </div>
      <div style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.45 }}>
        {invitation.recipientEmail
          ? `Invited ${formatDate(invitation.createdAt, { day: "2-digit", month: "short" })} — nothing is granted until they accept.`
          : "Nothing is granted until they accept."}
      </div>
    </Card>
  );
}

function badgeStatusForParticipant(raw: string): Status {
  if (raw === "confirmed" || raw === "active" || raw === "accepted") return "confirmed";
  if (raw === "invited" || raw === "pending") return "pending";
  if (raw === "declined" || raw === "removed") return "cancelled";
  return "draft";
}

/**
 * A PARTICIPANT's status, in its own words.
 *
 * `apiStatusToDisplay` translates the EVENT status vocabulary, and the two enums
 * only look alike: `event_participant_status` is
 * `invited | accepted | declined | confirmed | removed`, and `invited` is not in
 * the event enum at all — so it fell through to the default and a crew member
 * who had just been added to the bill was labelled "Draft". The badge TONE was
 * right the whole time, which is exactly how the wrong word survived.
 */
const PARTICIPANT_STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  accepted: "Accepted",
  declined: "Declined",
  confirmed: "Confirmed",
  removed: "Removed",
};

function participantStatusLabel(raw: string): string {
  return PARTICIPANT_STATUS_LABEL[raw] ?? statusLabel(raw);
}

/**
 * Messages are per-party threads now, not one per-event thread — the screen just
 * hands the roster down so a sender can be named. The rule (who is in which
 * thread) is the server's, in `apps/api/src/lib/message-threads.ts`.
 */
function MessagesTab({ eventId, roster }: { eventId: string; roster: Participant[] }) {
  return (
    <EventMessagesTab
      eventId={eventId}
      roster={roster.map((party) => ({ id: party.id, name: participantName(party) }))}
    />
  );
}

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}
