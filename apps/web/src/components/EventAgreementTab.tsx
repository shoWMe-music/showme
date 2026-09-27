import {
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdSchedule,
  useGetApiV1EventsIdSchedule,
} from "@showme/api-client";
import { Button, EmptyState, Icon } from "@showme/design-system";
import { PAYMENT_TIMING_OPTIONS, dealKindLabel, eventParticipantRoleLabel } from "@showme/shared";
import { useState } from "react";
import { formatDay, formatMoney, formatTime } from "../lib/format";
import type { AgreementField } from "./AgreementView";
import { DealAgreementCard, type DealPartyLine, shareLabelOf } from "./DealAgreementCard";
import { DealComposerModal, type DealPartyChoice } from "./DealComposerModal";
import { DealReopenModal } from "./DealReopenModal";
import { DealTermsModal } from "./DealTermsModal";
import type { ScheduleEntry } from "./ScheduleList";
import { ErrorState, LoadingState } from "./states";
import { useDealCardExpansion } from "./useDealCardExpansion";
import { useDealComposer } from "./useDealComposer";
import { useDealTermsEditor } from "./useDealTermsEditor";
import { dealActionsFor, useEventAgreements } from "./useEventAgreements";

type Deal = Awaited<ReturnType<typeof getApiV1EventsIdDeals>>["deals"][number];
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];
type ScheduleItem = Awaited<ReturnType<typeof getApiV1EventsIdSchedule>>[number];

export interface EventAgreementTabProps {
  eventId: string;
  eventTitle: string;
  eventDate: string | null;
  eventStatusLabel: string;
  /** The caller's own effective capabilities on this event — what may be offered. */
  capabilities: readonly string[];
  /**
   * The event's base currency: what a new deal is denominated in by default, and
   * the fallback for a deal that names none. A DEAL'S OWN currency always wins
   * over it — a euro guarantee on a krona event is a euro guarantee.
   *
   * There used to be a second prop for a "display currency" picked in the header.
   * That picker only ever changed the symbol without converting anything, and it
   * is gone (ClickUp 123qy9rnjb8); the two props always carried the same value by
   * the end, and one of them was lying about what it meant.
   */
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
  const terms = useDealTermsEditor(eventId);

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
        /* EMPTY IS TWO DIFFERENT ANSWERS. A reader sees only the deals they are a
           party to (story.md: an operator's breadth is emergent, not god-mode), so
           an empty list can mean the night has no deals OR that its deals are not
           this reader's to read. A co-promoter on a show with a signed agreement was
           told "No deal yet", which is the one thing it was not. */
        <EmptyState
          icon={<Icon name={agreements.hiddenDealCount > 0 ? "eye-off" : "file"} />}
          title={agreements.hiddenDealCount > 0 ? "Not your deal to see" : "No deal yet"}
          description={
            agreements.hiddenDealCount > 0
              ? agreements.hiddenDealCount === 1
                ? "This event has a deal, and you are not a party to it. Ask the host to add you to it if you need its terms."
                : `This event has ${agreements.hiddenDealCount} deals, and you are not a party to any of them. Ask the host to add you if you need their terms.`
              : agreements.authority.canCompose
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
            dealStructure={dealStructureFields(deal, baseCurrency)}
            schedule={scheduleEntries}
            parties={partyLines(deal, agreements.roster)}
            actions={dealActionsFor(deal, agreements.authority, agreements.roster)}
            busy={agreements.busyDealId === deal.id}
            termsText={deal.agreementBodyText}
            // The terms are live until the last signature and frozen after it —
            // the same line `agreement_status` already draws for the figures.
            canEditTerms={
              agreements.authority.canCompose &&
              deal.agreementStatus !== "confirmed" &&
              deal.agreementStatus !== "signed"
            }
            onEditTerms={() =>
              terms.open({
                id: deal.id,
                name: deal.name,
                agreementBodyText: deal.agreementBodyText,
                version: deal.version,
              })
            }
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
      <DealTermsModal editor={terms} />
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
  return (
    participant.name ?? participant.performerTag ?? eventParticipantRoleLabel(participant.role)
  );
}

function partyChoices(roster: Participant[]): DealPartyChoice[] {
  return roster.map((participant) => ({
    id: participant.id,
    label: participantName(participant),
    roleLabel: eventParticipantRoleLabel(participant.role),
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
function dealStructureFields(deal: Deal, fallbackCurrency: string): AgreementField[] {
  // The deal's own currency is authoritative; the event's base is only what to
  // use when the deal names none.
  const currency = deal.currency ?? fallbackCurrency;
  const rows: AgreementField[] = [
    // ONE row, because the composer now asks ONE question: the kind of deal IS
    // the settlement shape, and `deals.type` is derived from it. Reading it back
    // as "Kind" plus "Settles as" would restate the split the menu just lost.
    { label: "Kind of deal", value: dealKindLabel(deal.type, deal.structure ?? null) },
  ];
  if (deal.guaranteeAmount) {
    rows.push({ label: "Fixed amount", value: formatMoney(deal.guaranteeAmount, currency) });
  }
  if (deal.splitBasisPoints != null) {
    rows.push({
      // "…of the adjusted net", matching the settlement's own waterfall caption.
      // `pool` and `adjustedNet` are DIFFERENT quantities in `reconcile`, and
      // decisions #24.1 makes the percentage divide the adjusted net — so "share of
      // the pool" named the wrong one, on the card a party reads to check their deal.
      // One quantity, one name, across the deal, the agreement and the settlement.
      label: "Share of the adjusted net",
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
  /**
   * WHY IT WAS REOPENED (ClickUp `123qy9rnh3f`).
   *
   * Last, because it is about the agreement's state rather than its terms — and only
   * while it is unsigned: once everybody has signed again, the renegotiation that
   * prompted it is over and the sentence would be describing a settled thing. The
   * reason is recorded on the deal either way.
   */
  if (deal.reopenReason && deal.agreementStatus !== "confirmed") {
    rows.push({ label: "Reopened because", value: deal.reopenReason });
  }
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
