import {
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdSchedule,
  useGetApiV1EventsIdSchedule,
} from "@showme/api-client";
import { Button, EmptyState, Icon } from "@showme/design-system";
import { DEAL_STRUCTURE_OPTIONS, DEAL_TYPE_OPTIONS, PAYMENT_TIMING_OPTIONS } from "@showme/shared";
import { useState } from "react";
import { formatDate, formatMoney } from "../lib/format";
import type { AgreementField } from "./AgreementView";
import { DealAgreementCard, type DealPartyLine, shareLabelOf } from "./DealAgreementCard";
import { DealComposerModal, type DealPartyChoice } from "./DealComposerModal";
import { DealReopenModal } from "./DealReopenModal";
import type { ScheduleEntry } from "./ScheduleList";
import { ErrorState, LoadingState } from "./states";
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
 * The Agreement tab: every agreement this caller is a party to, and the lifecycle
 * that moves them.
 *
 * What was here before rendered `GET /events/:id/deals` and, when the list came
 * back empty, an EmptyState reading "No agreement yet" — with nothing anywhere in
 * the app that could ever create one. The list was empty on every event, for
 * every account, permanently. The tab now carries the door in as well as the
 * view: compose, send, confirm, reopen.
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
  const composer = useDealComposer(baseCurrency, agreements.agentParticipantIds, composerOpen);

  if (agreements.isPending) return <LoadingState label="Loading agreements" />;
  if (agreements.isError) {
    return <ErrorState error={agreements.error} title="Couldn't load the agreements" />;
  }

  const submitComposer = async () => {
    composer.markSubmitAttempted();
    if (composer.problems.length > 0) return;
    if (await agreements.compose(composer.draft)) setComposerOpen(false);
  };

  const scheduleEntries = toScheduleEntries(schedule.data ?? []);
  const choices = partyChoices(agreements.roster);

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
          Agreements you are a party to. Each party sees only its own line.
        </span>
        {agreements.authority.canCompose && (
          <Button
            variant="primary"
            leftIcon={<Icon name="plus" size={14} />}
            onClick={() => setComposerOpen(true)}
          >
            New agreement
          </Button>
        )}
      </div>

      {agreements.deals.length === 0 ? (
        <EmptyState
          icon={<Icon name="file" />}
          title="No agreement yet"
          description={
            agreements.authority.canCompose
              ? "Write the terms down and send them to the other parties. Nothing settles until they confirm."
              : "When an agreement naming you is sent, its terms appear here for you to confirm."
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
            actions={dealActionsFor(deal, agreements.authority)}
            busy={agreements.busyDealId === deal.id}
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
    {
      label: "Date",
      value: formatDate(event.eventDate, { day: "2-digit", month: "short", year: "numeric" }),
    },
    { label: "Venue", value: event.venueLabel },
    { label: "Operator", value: event.operatorName },
    { label: "Agreement", value: deal.name },
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
      time: item.localDateTime
        ? new Date(item.localDateTime).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
      label: item.label,
    }));
}
