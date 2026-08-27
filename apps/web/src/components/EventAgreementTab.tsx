import {
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdSchedule,
  useGetApiV1EventsIdSchedule,
} from "@showme/api-client";
import { Button, EmptyState, Icon } from "@showme/design-system";
import { DEAL_STRUCTURE_OPTIONS, DEAL_TYPE_OPTIONS, PAYMENT_TIMING_OPTIONS } from "@showme/shared";
import { useState } from "react";
import { formatDay, formatMoney, formatTime } from "../lib/format";
import type { AgreementField } from "./AgreementView";
import { DealAgreementCard, type DealPartyLine, shareLabelOf } from "./DealAgreementCard";
import { DealComposerModal, type DealPartyChoice } from "./DealComposerModal";
import { DealReopenModal } from "./DealReopenModal";
import type { ScheduleEntry } from "./ScheduleList";
import { ErrorState, LoadingState } from "./states";
import { useDealCardExpansion } from "./useDealCardExpansion";
import { useDealComposer } from "./useDealComposer";
import { dealActionsFor, useEventAgreements } from "./useEventAgreements";

type Deal = Awaited<ReturnType<typeof getApiV1EventsIdDeals>>[number];
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];
type ScheduleItem = Awaited<ReturnType<typeof getApiV1EventsIdSchedule>>[number];

export interface EventAgreementTabProps {
  eventId: string;
  eventTitle: string;
  eventDate: string | null;
  eventStatusLabel: string;
  /** The caller's own effective capabilities on this event — what may be offered. */
  capabilities: readonly string[];
  /** The display currency chosen in the header; a deal's own currency wins over it. */
  currency: string;
  /** The event's base currency — what a new deal is denominated in by default. */
  baseCurrency: string;
  venueLabel: string;
  operatorName: string;
}

/**
 * The deals section: every deal this caller is a party to, and the lifecycle that
 * moves them.
 *
 * VOCABULARY (product owner, 2026-08): *"A deal has an agreement. Not the other
 * way around."* The **deal** is the object — the thing composed, listed, named and
 * settled — so every noun the screen prints for it reads "deal". **Agreement** is
 * kept only where it means the state the parties reached: the confirmation
 * language, `agreement_status`'s labels, and "Paper agreement only" (terms that
 * exist on paper and settle nothing). Renaming the schema is explicitly NOT part
 * of that — `agreement_status` and the `agreement.confirm` capability keep their
 * names; what stops is calling the container an agreement.
 *
 * What was here before rendered `GET /events/:id/deals` and, when the list came
 * back empty, an empty state — with nothing anywhere in the app that could ever
 * create one. The list was empty on every event, for every account, permanently.
 * The tab now carries the door in as well as the view: compose, send, confirm,
 * reopen.
 */
export function EventAgreementTab({
  eventId,
  eventTitle,
  eventDate,
  eventStatusLabel,
  capabilities,
  currency,
  baseCurrency,
  venueLabel,
  operatorName,
}: EventAgreementTabProps) {
  const agreements = useEventAgreements(eventId, capabilities);
  const schedule = useGetApiV1EventsIdSchedule(eventId);
  const [composerOpen, setComposerOpen] = useState(false);
  const [reopening, setReopening] = useState<{ dealId: string; name: string } | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const choices = partyChoices(agreements.roster);
  // The roster, by name — an agreement with no name of its own takes the names of
  // the parties it pays (2026-08 meeting: "deal naming uses the name of the person
  // or entity on the agreement").
  const composer = useDealComposer(
    baseCurrency,
    agreements.agentParticipantIds,
    composerOpen,
    choices,
  );
  // What the caller can SEE, which is what "only one deal" counts: the server
  // serves each party only the deals it is a party to. Above the loading
  // branches because a hook cannot live behind an early return; before the list
  // arrives it is empty, which the rule answers correctly on its own.
  const expansion = useDealCardExpansion(agreements.deals.map((deal) => deal.id));

  if (agreements.isPending) return <LoadingState label="Loading deals" />;
  if (agreements.isError) {
    return <ErrorState error={agreements.error} title="Couldn't load the deals" />;
  }

  const submitComposer = async () => {
    composer.markSubmitAttempted();
    if (composer.problems.length > 0) return;
    if (await agreements.compose(composer.draft)) setComposerOpen(false);
  };

  const scheduleEntries = toScheduleEntries(schedule.data ?? []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
          Deals you are a party to. Each party sees only its own line.
        </span>
        {agreements.authority.canCompose && (
          <Button
            variant="primary"
            leftIcon={<Icon name="plus" size={14} />}
            onClick={() => setComposerOpen(true)}
          >
            New deal
          </Button>
        )}
      </div>

      {agreements.deals.length === 0 ? (
        <EmptyState
          icon={<Icon name="file" />}
          title="No deal yet"
          description={
            agreements.authority.canCompose
              ? "Write the terms down and send them to the other parties. Nothing settles until they confirm."
              : "When a deal naming you is sent, its terms appear here for you to confirm."
          }
        />
      ) : (
        agreements.deals.map((deal) => (
          <DealAgreementCard
            key={deal.id}
            dealId={deal.id}
            name={deal.name}
            agreementStatus={deal.agreementStatus}
            summary={agreementSummary(deal, {
              eventTitle,
              eventDate,
              eventStatusLabel,
              venueLabel,
              operatorName,
            })}
            dealStructure={dealStructureFields(deal, currency)}
            schedule={scheduleEntries}
            parties={partyLines(deal, agreements.roster)}
            actions={dealActionsFor(deal, agreements.authority, agreements.roster)}
            busy={agreements.busyDealId === deal.id}
            expanded={expansion.isExpanded(deal.id)}
            onToggleExpanded={() => expansion.toggle(deal.id)}
            onSend={agreements.send}
            onConfirm={agreements.confirm}
            onReopen={(dealId) => {
              setReopenReason("");
              setReopening({ dealId, name: deal.name });
            }}
            onExportPdf={() => window.print()}
          />
        ))
      )}

      <DealComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSubmit={submitComposer}
        composer={composer}
        choices={choices}
        currency={baseCurrency}
        pending={agreements.isBusy}
      />
      <DealReopenModal
        open={reopening !== null}
        dealName={reopening?.name ?? ""}
        reason={reopenReason}
        onReasonChange={setReopenReason}
        onClose={() => setReopening(null)}
        onConfirm={() => {
          if (!reopening) return;
          agreements.reopen(reopening.dealId, reopenReason.trim());
          setReopening(null);
        }}
        pending={agreements.isBusy}
      />
    </div>
  );
}

/** A participant's display name — the public face, else its role tag. */
function participantName(participant: Participant): string {
  return participant.name ?? participant.performerTag ?? roleLabel(participant.role);
}

function roleLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

function partyChoices(roster: Participant[]): DealPartyChoice[] {
  return roster.map((participant) => ({
    id: participant.id,
    label: participantName(participant),
    roleLabel: roleLabel(participant.role),
    isAgent: participant.role === "agent",
  }));
}

function partyLines(deal: Deal, roster: Participant[]): DealPartyLine[] {
  return deal.parties.map((party) => {
    const participant = roster.find((row) => row.id === party.participantId);
    return {
      id: party.id,
      name: participant ? participantName(participant) : "Participant",
      roleInDeal: party.roleInDeal,
      confirmedAt: party.confirmedAt,
      isYours: party.isYours,
      shareLabel: shareLabelOf(party.share),
    };
  });
}

function agreementSummary(
  deal: Deal,
  event: {
    eventTitle: string;
    eventDate: string | null;
    eventStatusLabel: string;
    venueLabel: string;
    operatorName: string;
  },
): AgreementField[] {
  return [
    { label: "Event", value: event.eventTitle },
    { label: "Date", value: formatDay(event.eventDate) },
    { label: "Venue", value: event.venueLabel },
    { label: "Operator", value: event.operatorName },
    { label: "Deal", value: deal.name },
    { label: "Event status", value: event.eventStatusLabel },
  ];
}

/**
 * The money terms, in the same words the composer used to ask for them — a deal
 * described as "Guarantee vs door" when it was written should not read back as
 * "Guarantee_vs_door".
 */
function dealStructureFields(deal: Deal, displayCurrency: string): AgreementField[] {
  const currency = deal.currency ?? displayCurrency;
  const rows: AgreementField[] = [
    {
      label: "Kind",
      value: DEAL_TYPE_OPTIONS.find((option) => option.value === deal.type)?.label ?? deal.type,
    },
    {
      label: "Settles as",
      value:
        DEAL_STRUCTURE_OPTIONS.find((option) => option.value === (deal.structure ?? null))?.label ??
        "Paper agreement only",
    },
  ];
  if (deal.guaranteeAmount) {
    rows.push({ label: "Fixed amount", value: formatMoney(deal.guaranteeAmount, currency) });
  }
  if (deal.splitBasisPoints != null) {
    rows.push({
      label: "Share of the pool",
      value: `${(deal.splitBasisPoints / 100).toFixed(0)}%`,
    });
  }
  if (deal.advanceAmount) {
    rows.push({ label: "Paid in advance", value: formatMoney(deal.advanceAmount, currency) });
  }
  rows.push({
    label: "Paid",
    value:
      PAYMENT_TIMING_OPTIONS.find((option) => option.value === deal.paymentTiming)?.label ??
      deal.paymentTiming,
  });
  return rows;
}

function toScheduleEntries(items: ScheduleItem[]): ScheduleEntry[] {
  return items
    .slice()
    .sort((left, right) => (left.localDateTime ?? "").localeCompare(right.localDateTime ?? ""))
    .map((item) => ({
      time: formatTime(item.localDateTime),
      label: item.label,
    }));
}
