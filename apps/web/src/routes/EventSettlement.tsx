import {
  type getApiV1EventsId,
  useGetApiV1Activity,
  useGetApiV1EventsId,
  useGetApiV1EventsIdSettlementPlannedVsActual,
} from "@showme/api-client";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  KeyValueRow,
  SelectCard,
  Tabs,
  TextField,
} from "@showme/design-system";
import { Link, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { ConfirmDialog, useConfirmDialog } from "../components/ConfirmDialog";
import { DateText } from "../components/DateText";
import { SendForReviewDialog } from "../components/SendForReviewDialog";
import { SettlementActualsCard } from "../components/SettlementActualsCard";
import { SettlementCurationCard } from "../components/SettlementCurationCard";
import {
  CurrencyPreviewNotice,
  SettlementCurrencyControl,
  useCurrencyPreview,
} from "../components/SettlementCurrencyPreview";
import { SettlementDeliveryCard } from "../components/SettlementDeliveryCard";
import { SettlementLinePreview } from "../components/SettlementLinePreview";
import { SettlementPartyCard } from "../components/SettlementPartyCard";
import { PartyPositionsCard, TotalSettlementCard } from "../components/SettlementShares";
import { SettlementStepper } from "../components/SettlementStepper";
import { SettlementViewingAs } from "../components/SettlementViewingAs";
import { UnsignedAgreementsNotice } from "../components/UnsignedAgreementsNotice";
import { type SettlementLine, WhoOwesWhomBoard } from "../components/WhoOwesWhomBoard";
import { describeActivity } from "../components/eventHistory";
import { CardTitle, Eyebrow } from "../components/primitives";
import {
  initialsOf,
  settlementStatusToDisplay,
  settlementSteps,
} from "../components/settlementDocument";
import { ErrorState, LoadingState } from "../components/states";
import {
  // Aliased: the page component below is also called `EventSettlement`, and the
  // route file is named for the screen rather than for the hook's return type.
  type EventSettlement as EventSettlementData,
  type SettlementAgreementRow,
  useEventSettlement,
} from "../components/useEventSettlement";
import { useSettlementCuration } from "../components/useSettlementCuration";
import { type SettlementLineRow, useSettlementLines } from "../components/useSettlementLines";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { formatDay, formatMoney } from "../lib/format";
import { toMinorUnits } from "../lib/moneyUnits";
import { PRO_FILING_AVAILABLE } from "../lib/proFilingAvailability";
import { apiStatusToDisplay } from "../lib/status";
import styles from "./EventSettlement.module.css";

/**
 * The full settlement workspace — its own page, reached from the event's thin
 * Settlement tab and from the Settlements list.
 *
 * It is keyed by the EVENT, not by one settlement row, and that is the one place
 * this departs from the prototype: the prototype is single-performer throughout,
 * so "the settlement" could be one document. Our model is **one settlement per
 * participant** and a night has several, so the page shows every line the caller
 * may see and marks their own. A per-settlement URL would have to answer "whose?"
 * on a screen whose whole job is to put the parties side by side.
 *
 * There is deliberately **no "Deal Structure" tab** (ClickUp 86cbaxvb9). A deal is
 * authored in ONE place — the event's own Deals tab — and a second tab named after
 * deals, on a screen that could only ever show them once the engine had run, read
 * as that tab broken: the product owner opened it moments after confirming a Door
 * Split next door and was told "No settled agreement to show". What the agreement
 * actually PAID is a fact about the reconciliation, so it is folded into the
 * Settlement tab beside the pool it divides (`SettledAgreements`).
 *
 * Every figure on screen is a field the API served, formatted by the hook. The
 * browser does no money arithmetic.
 */
export function EventSettlement() {
  const { eventId } = useParams({ from: "/events/$eventId/settlement" });
  const [tab, setTab] = useState("overview");
  // Seeded from the reader's account preference (`users.currency`), which until
  // 2026-09-04 was stored and read by nothing — see `useDisplayCurrency`. An
  // inherited default that has no exchange rate falls back to the settlement's
  // own currency SILENTLY; only a currency the reader picks here warns.
  const displayCurrency = useDisplayCurrency();
  const event = useGetApiV1EventsId(eventId);
  const baseCurrency = event.data?.baseCurrency ?? "";
  // Cosmetic only. The formatter converts for READING; nothing it touches is what
  // the settlement owes, records or pays (`docs/money.md`).
  const preview = useCurrencyPreview(
    baseCurrency,
    displayCurrency.previewCurrency,
    displayCurrency.setPreviewCurrency,
    displayCurrency.isExplicitChoice,
  );
  const settlement = useEventSettlement(
    eventId,
    event.data?.capabilities ?? [],
    baseCurrency,
    preview.format,
  );

  if (event.isPending) return <LoadingState label="Loading settlement" />;
  if (event.isError) return <ErrorState error={event.error} title="Couldn't load this event" />;

  const status = settlementStatusToDisplay(settlement.status);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1180 }}>
      <div>
        <Link
          to="/events/$eventId"
          params={{ eventId }}
          // Touch: 98x20. An overlay, not growth: this link sits alone above the
          // page title with nothing interactive within 44px of it, and growing
          // it would open a 24px gap under the header it belongs to.
          className="touch-target-overlay"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          <Icon name="chevron-right" size={16} style={{ transform: "rotate(180deg)" }} />
          Back to event
        </Link>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <Eyebrow>Settlement</Eyebrow>
          {/* The design titles a settlement by WHO and WHERE — "Nils Frahm /
              Funkhaus" — because that is how a settlement is referred to out loud.
              The venue is only repeated in the line beneath when there is a city
              to put with it. */}
          <h2 style={{ margin: "6px 0", fontSize: 28, letterSpacing: "-0.025em" }}>
            {event.data.title}
            {event.data.venueName && (
              <>
                <span style={{ color: "var(--dim)", fontWeight: 400 }}> / </span>
                {event.data.venueName}
              </>
            )}
          </h2>
          <div
            style={{
              color: "var(--muted)",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {/* The design puts the city here ("Funkhaus · Berlin · Jul 04"). The
                event payload carries no city of its own — it lives on the venue
                PROFILE — so the line renders what it has rather than a blank
                separator, and gains the city when the event serves one. */}
            {event.data.venueName && <span>{event.data.venueName} ·</span>}
            <DateText value={event.data.eventDate} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* ONE PILL, the settlement's own. The design puts a single status here
              and the event's own state belongs to the event screen — carrying both
              pushed the row onto a third line and made the reader work out which
              of two words described the money. */}
          <Badge status={status.status} dot>
            {status.label}
          </Badge>
          {/* A POINTER to the PRO filing, which lives on its own screen — royalties
              are a different money stream and never enter this page's Σ net = 0.
              Dark until shoWMe has agreements with the societies (ClickUp
              86cbaxydb, `lib/proFilingAvailability`): pointing at a screen whose
              filing actions are all "coming soon" is a promise, not a shortcut.
              The capability check stays beside the flag so that flipping the flag
              still shows the link only to someone who could actually file. */}
          <SettlementCurrencyControl preview={preview} />
          {PRO_FILING_AVAILABLE &&
            (event.data.capabilities ?? []).includes("performance_report.file") && (
              <Link to="/reports">
                <Button variant="secondary" leftIcon={<Icon name="trending-up" size={14} />}>
                  Report to PRO
                </Button>
              </Link>
            )}
        </div>
      </div>

      <CurrencyPreviewNotice preview={preview} />

      <Tabs
        value={tab}
        onChange={setTab}
        /*
         * THE DESIGN'S SIX, in its order
         * (`claude-prototype/ran-2026-09-10/renders/`).
         *
         * "Comments" is gone as a tab and is not gone as a feature: the design
         * puts the thread in the Settlement tab's right rail, beside the figures
         * it is about, which is where a remark on a settlement belongs — answering
         * one MEANS changing a number, and a tab away from the numbers made the
         * reader hold both in their head.
         */
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "deal-structure", label: "Deal structure" },
          { key: "financials", label: "Financials" },
          { key: "settlement", label: "Settlement" },
          { key: "collaborators", label: "Collaborators" },
          { key: "payout", label: "Payout" },
        ]}
      />

      {settlement.isPending ? (
        <LoadingState label="Loading settlement" />
      ) : settlement.isError ? (
        <ErrorState error={settlement.error} title="Couldn't load the settlement" />
      ) : tab === "overview" ? (
        <OverviewTab event={event.data} settlement={settlement} />
      ) : tab === "deal-structure" ? (
        <DealStructureTab event={event.data} settlement={settlement} />
      ) : tab === "financials" ? (
        <FinancialsTab
          eventId={eventId}
          settlement={settlement}
          currency={baseCurrency}
          onGoToSettlement={() => setTab("settlement")}
        />
      ) : tab === "collaborators" ? (
        <CollaboratorsTab settlement={settlement} />
      ) : tab === "payout" ? (
        <PayoutTab settlement={settlement} />
      ) : (
        <SettlementTab settlement={settlement} eventId={eventId} currency={baseCurrency} />
      )}
    </div>
  );
}

type EventData = Awaited<ReturnType<typeof getApiV1EventsId>>;

const CARD_COLUMN = { display: "flex", flexDirection: "column", gap: 14 } as const;
const TWO_COLUMN = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 16,
  alignItems: "start",
} as const;

function OverviewTab({ event, settlement }: { event: EventData; settlement: EventSettlementData }) {
  const eventStatus = apiStatusToDisplay(event.status);
  /*
   * Its own call, not a prop threaded down from the Financials tab.
   *
   * `useSettlementLines` IS the data source, and TanStack Query dedupes the two
   * subscriptions into one request — so asking it here costs a cache read, while
   * lifting it into the route and passing it through two components would make
   * every tab depend on a query only one of them uses.
   */
  const lines = useSettlementLines(event.id, event.baseCurrency);
  return (
    <div style={CARD_COLUMN}>
      {/*
       * The design's Overview reads top to bottom: who and where, then the chain
       * down to the adjusted net beside the division of it. Event details runs
       * full width because it is context for both cards under it.
       */}
      <div>
        {/*
         * The design's Event details: the people and the room, not just the date.
         * Its grid reads EVENT ID · PERFORMER · VENUE / OPERATOR · TICKETING ·
         * CAPACITY, and the point of putting the parties HERE is that ClickUp
         * `86cbcn1ue` asked for exactly that — *"Performer/Promoter or any other
         * collaborator details must appear in the Overview section"*.
         *
         * Names come from the settlement's own roster, so a row is drawn only when
         * the reader may see that party. "Event ID" is deliberately not drawn: our
         * id is a uuid, which is the design's field carrying a value nobody can
         * read out over a phone.
         */}
        <Card padding="lg" style={CARD_COLUMN}>
          <CardTitle>Event details</CardTitle>
          <DetailGrid
            cells={[
              { key: "date", label: "Date", value: <DateText value={event.eventDate} /> },
              { key: "venue", label: "Venue", value: event.venueName ?? "Not set" },
              ...settlement.shares.map((share) => ({
                key: share.key,
                label: share.role,
                value: share.name,
              })),
              {
                key: "capacity",
                label: "Capacity",
                value: event.capacity != null ? String(event.capacity) : "Not set",
              },
              { key: "status", label: "Event status", value: eventStatus.label },
              { key: "currency", label: "Settles in", value: event.baseCurrency, mono: true },
            ]}
          />
        </Card>
      </div>

      {/* The design's second row: the chain down to the adjusted net, beside the
          division of it.
          The "Your settlement" block that used to hang off the bottom of the
          waterfall is gone rather than moved — every reader's own figure is in the
          card beside it now, under their own name and with the rule that produced
          it, which is strictly more than a bare number under a heading. */}
      <div style={TWO_COLUMN}>
        <Card padding="lg" style={CARD_COLUMN}>
          <CardTitle subtitle="How the box office resolves into the net every share divides.">
            Financial overview
          </CardTitle>
          <PoolLadderRows settlement={settlement} />
        </Card>
        <TotalSettlementCard settlement={settlement} />
      </div>

      {/*
       * WHAT WAS AGREED, and WHAT THE TICKETS DID — the two questions the Overview
       * could not answer (ClickUp `86cbcn1ue`: *"Deal type and Fee must appear in
       * the Overview section"*, *"Ticketing info must appear in the Overview
       * section"*).
       *
       * Both sit ABOVE the party cards, because both are the context those figures
       * are read against: a reader checks what the deal says, then what the night
       * took, then who ends up with what. The old order started at the answer.
       */}
      <TicketingSummaryCard
        revenue={lines.revenue}
        visible={settlement.ladder != null}
        currency={event.baseCurrency}
      />

      {settlement.parties.length === 0 && <NothingSettledYet settlement={settlement} />}
    </div>
  );
}

/**
 * THE DESIGN'S EVENT-DETAILS GRID — a bordered cell per fact, label above value,
 * three across.
 *
 * Not `KeyValueRow`, and the difference is deliberate rather than decorative. A
 * key-value row is for a COLUMN of related figures the eye runs down — the
 * waterfall, a party's rule lines. This is a set of unrelated facts the reader
 * picks one of ("what's the capacity?"), and the design lays those out as cells
 * precisely because scanning a 3×2 grid for one label beats reading seven rows.
 *
 * The cell count is not fixed: a night with three acts has three party rows, and
 * the grid reflows rather than overflowing. `auto-fit` with a `minmax(0, …)` floor
 * so a long venue name cannot push the card sideways (CLAUDE.md's overflow rule).
 */
function DetailGrid({
  cells,
}: {
  cells: { key: string; label: string; value: ReactNode; mono?: boolean }[];
}) {
  // Complete the last row so the 1px gap never shows through where a cell is
  // missing. The count is not fixed — a bill with three acts has three party
  // cells — so this cannot be solved by choosing the right number of facts.
  const columns = 3;
  const fillers = (columns - (cells.length % columns)) % columns;
  return (
    <div className={styles.detailGrid}>
      {cells.map((cell) => (
        <div key={cell.key} className={styles.detailCell}>
          <Eyebrow>{cell.label}</Eyebrow>
          <span
            className={`${styles.detailValue} ${cell.mono ? styles.detailValueMono : ""}`.trim()}
          >
            {cell.value}
          </span>
        </div>
      ))}
      {/* Blank cells, so they have nothing to key on but their position — which
          is the one case where an index key is the honest answer rather than a
          shortcut: these are not data and never reorder. */}
      {Array.from({ length: fillers }, (_unused, index) => index).map((index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: position IS the identity of a blank cell
          key={`filler-${index}`}
          className={styles.detailCell}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/**
 * DEAL STRUCTURE — what was agreed, and what it paid.
 *
 * This tab existed once, was deleted for cause (ClickUp `86cbaxvb9`: it read as a
 * broken second Deals tab, telling an operator "No settled agreement to show"
 * moments after they confirmed a Door Split), and is back because the design has
 * it — but not as the thing that was deleted.
 *
 * The difference is what it holds. The old one showed ONLY the settled reading,
 * so before a reconciliation it was empty and looked broken. This one leads with
 * the TERMS, which exist the moment an agreement is written, and shows the settled
 * reading underneath when there is one. It is still read-only and it is still not
 * where a deal is authored — that is the event's own Deals tab, and there is
 * exactly one of those.
 */
function DealStructureTab({
  event,
  settlement,
}: { event: EventData; settlement: EventSettlementData }) {
  const lines = useSettlementLines(event.id, event.baseCurrency);
  if (settlement.agreements.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="file" />}
        title="No agreements on this event yet"
        description="Deal terms are written on the event's Deals tab. Once an agreement exists, its structure and what it paid appear here."
      />
    );
  }
  // What the SETTLEMENT made of each agreement, keyed so a card can show its own
  // outcome beside its own terms. Empty until the night is reconciled, which is
  // the state the deleted "Deal Structure" tab could only ever show.
  const settledByDeal = new Map(settlement.deals.map((deal) => [deal.dealId, deal]));
  return (
    <div style={CARD_COLUMN}>
      {settlement.agreements.map((agreement) => {
        const settled = settledByDeal.get(agreement.dealId);
        return (
          <Card key={agreement.dealId} padding="lg" style={CARD_COLUMN}>
            <CardTitle subtitle="How the box office splits before anyone is paid. Read from the agreement itself.">
              {agreement.name}
            </CardTitle>

            {/* The design's tinted sentence: which arm of the deal won, in words,
                for each party the agreement paid. Drawn only once the engine has
                actually compared them — before that there is no winner to name,
                and asserting one from the terms alone would be a forecast wearing
                a settled figure's clothes. */}
            {settled?.shares.map((share) => (
              <div
                key={share.key}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--elevated, var(--surface))",
                  fontSize: 13.5,
                  lineHeight: 1.5,
                }}
              >
                <Icon name="music" size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  <strong>{share.name}</strong> · {share.rule} — {share.amount}
                </span>
              </div>
            ))}

            <DetailGrid
              cells={[
                { key: "kind", label: "Deal type", value: agreement.kind },
                ...(agreement.fee
                  ? [{ key: "fee", label: "Guarantee", value: agreement.fee, mono: true }]
                  : []),
                ...(agreement.share
                  ? [{ key: "share", label: "Revenue split", value: agreement.share }]
                  : []),
                ...(agreement.paidInAdvance
                  ? [
                      {
                        key: "advance",
                        label: "Paid in advance",
                        value: agreement.paidInAdvance,
                        mono: true,
                      },
                    ]
                  : []),
                ...(settled
                  ? [
                      {
                        key: "paid",
                        label: "What it paid",
                        value: settled.dealTotal,
                        mono: true,
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        );
      })}

      <TicketRevenueSplitCard
        agreements={settlement.agreements}
        revenue={lines.revenue}
        currency={event.baseCurrency}
        adjustedNet={settlement.adjustedNet}
      />
    </div>
  );
}

/**
 * THE TICKET-REVENUE SPLIT — the design's second Deal-structure card, and it is
 * an ILLUSTRATION, which is the only reason it is allowed to exist beside the
 * real entitlements.
 *
 * The design captions it *"Box office only, before costs and rental. Final
 * entitlements are on Overview."* and that caption is load-bearing: these are the
 * percentages applied to the box office, while the settlement applies them to the
 * adjusted net. The two figures differ by every cost on the night, and the
 * footnote says so with both numbers rather than leaving the reader to wonder
 * which of two 70%s they are looking at.
 *
 * That gap is exactly what the prototype got wrong — its Deal-structure sentence
 * states €53,760 (the box-office reading) as the performer's earnings while its
 * Overview pays €50,750 (the adjusted-net reading). Same deal, same night, two
 * answers. Here the illustration is labelled as one.
 */
function TicketRevenueSplitCard({
  agreements,
  revenue,
  currency,
  adjustedNet,
}: {
  agreements: SettlementAgreementRow[];
  revenue: SettlementLineRow[];
  currency: string;
  adjustedNet: string | null;
}) {
  const withSplit = agreements.filter((agreement) => agreement.splitBasisPoints != null);
  const ticketMinor = revenue
    .filter((line) => line.details?.basis === "ticket_tier")
    .reduce((total, line) => total + BigInt(toMinorUnits(line.amount)), 0n);
  if (withSplit.length === 0 || ticketMinor === 0n) return null;
  return (
    <Card padding="lg" style={CARD_COLUMN}>
      <CardTitle subtitle="Box office only, before costs and rental. Final entitlements are on Overview.">
        Ticket revenue split
      </CardTitle>
      {withSplit.map((agreement) => {
        const basisPoints = agreement.splitBasisPoints as number;
        // Integer arithmetic on minor units, as every figure on this screen is
        // (`docs/money.md`) — a percentage of money through a float is how a
        // settlement ends up a cent out of balance.
        const slice = (ticketMinor * BigInt(basisPoints)) / 10_000n;
        return (
          <KeyValueRow
            key={agreement.dealId}
            label={agreement.name}
            caption={`${(basisPoints / 100).toFixed(0)}% of the box office`}
            value={formatMoney(slice.toString(), currency)}
            mono
          />
        );
      })}
      <KeyValueRow
        label="Ticket revenue"
        value={formatMoney(ticketMinor.toString(), currency)}
        mono
        total
      />
      {adjustedNet != null && (
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
          These are shares of ticket revenue only. Once deductions and any rental are applied, the
          adjusted net is {adjustedNet} — and that is what the settlement actually divides.
        </p>
      )}
    </Card>
  );
}

/**
 * COLLABORATORS — each party's position, and sending them their settlement.
 *
 * Both halves already existed: the positions were a stack of party cards on the
 * Settlement tab, and the delivery card sat under the approval roster. The design
 * gives them a tab together, which is the right pairing — "who is owed what" and
 * "have they been told" are one question asked twice, and an operator chasing a
 * signature was previously scrolling between two parts of a long page to ask it.
 */
function CollaboratorsTab({ settlement }: { settlement: EventSettlementData }) {
  if (settlement.parties.length === 0) {
    return <NothingSettledYet settlement={settlement} />;
  }
  return (
    <div style={CARD_COLUMN}>
      <PartyPositionsCard settlement={settlement} />
      <SettlementDeliveryCard settlement={settlement} />
    </div>
  );
}

function SettlementTab({
  settlement,
  eventId,
  currency,
}: { settlement: EventSettlementData; eventId: string; currency: string }) {
  const confirmDialog = useConfirmDialog();
  // The design makes sending a DIALOG rather than a button, because it carries
  // three decisions — everyone or one party, which party, and whether they may
  // see the whole thing (#24.2). A bare button could only ever mean the first.
  const [sendOpen, setSendOpen] = useState(false);
  // One party list feeds both "Viewing as" and the curation card, so the two can
  // never offer a name the other cannot show.
  const curation = useSettlementCuration(eventId);
  const editor = useSettlementLines(eventId, currency);
  const askToFinalize = () =>
    confirmDialog.ask({
      title: "Finalize this settlement?",
      body: (
        <>
          The figures freeze into an immutable record and the exchange rates that produced them are
          locked to it. After this the settlement cannot be recomputed and cannot be un-finalized —
          not from this screen and not from the API. Transfers can still be marked paid.
        </>
      ),
      confirmLabel: "Finalize and lock",
      destructive: true,
      onConfirm: settlement.finalize,
    });

  return (
    <div style={CARD_COLUMN}>
      {/* The design runs the rail the full width of its own card, with nothing
          else in it. Seven stops need the room — the stepper grows its connectors
          to fill whatever it is given. */}
      <Card padding="lg">
        <SettlementStepper steps={settlementSteps(settlement.status)} />
      </Card>

      {/* Then whose eyes you are reading through, then what you can do about it —
          the design's order, and the sensible one: the actions send a document,
          so you check the document first. */}
      {settlement.authority.canCompute && (
        <SettlementViewingAs eventId={eventId} parties={curation.parties} currency={currency} />
      )}

      <div>
        {/*
         * The design shows THREE actions, chosen by status, not every action at
         * once — "Add revision · Mark finalized · Flag dispute" on a settlement
         * under review. A row of five buttons asks the reader to work out which
         * one they want; a row of two or three tells them.
         *
         * A bare row on the page background, not a card: they act on everything
         * below, and boxing them made them look like the stepper's controls.
         */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {settlement.authority.canCompute && !settlement.isFinalized && (
            <Button
              variant={settlement.isComputed ? "secondary" : "primary"}
              // A SETTLEMENT CANNOT OPEN UNTIL EVERY DEAL IS SIGNED
              // (decisions.md #21). The API answers 409, so a live-looking button
              // here would fail every single time it was pressed — worse than no
              // button. Disabled rather than hidden, and the reason is printed
              // beside it: the operator's next move is to go and get a signature,
              // which they can only do if they are told which one.
              disabled={settlement.isBusy || settlement.unsignedAgreementsNotice != null}
              leftIcon={<Icon name="receipt" size={14} />}
              // Wrapped, because a bare handler would hand React's click event
              // to `compute` as its options object — and `event.seedFromBudget`
              // is undefined, so it would work by accident today and break the
              // day the options grow a second field.
              onClick={() => settlement.compute()}
            >
              {settlement.isComputed ? "Recalculate" : "Run the settlement"}
            </Button>
          )}
          {settlement.authority.canFinalize && settlement.isComputed && !settlement.isFinalized && (
            <Button
              variant="primary"
              // FINALIZE IS THE SECOND DOOR and refuses on the same rule
              // (decisions.md #21): it re-derives the whole settlement before
              // freezing it, so it 409s on an unsigned agreement exactly as
              // compute does. Left enabled it would be the most dangerous-looking
              // button on the screen doing nothing at all.
              disabled={settlement.isBusy || settlement.unsignedAgreementsNotice != null}
              onClick={askToFinalize}
            >
              Finalize
            </Button>
          )}
          {/* The review conversation (the 2026-08 meeting, 01:12:54). Offered only
              while the figures can still move — once they are frozen the only
              honest objection left is a dispute. */}
          {settlement.authority.canCompute && settlement.canReview && settlement.isComputed && (
            <>
              <Button
                variant="secondary"
                disabled={settlement.isBusy}
                leftIcon={<Icon name="mail" size={14} />}
                onClick={() => setSendOpen(true)}
              >
                Send for review
              </Button>
              <Button variant="secondary" disabled={settlement.isBusy} onClick={settlement.reissue}>
                Add revision
              </Button>
            </>
          )}
          {/* A party's own objection — the same authority that signs a settlement
              off, inverted. Available even once frozen, because that is when it
              matters most and saying so moves no money. */}
          {settlement.authority.canConfirm &&
            settlement.isComputed &&
            settlement.status !== "dispute" && (
              <Button variant="ghost" disabled={settlement.isBusy} onClick={settlement.flagDispute}>
                Flag a dispute
              </Button>
            )}
          {settlement.status === "dispute" && (
            <Badge status="pending" dot>
              Disputed — a party has objected to these figures
            </Badge>
          )}
          {settlement.isFinalized && (
            <Badge status="confirmed" dot>
              Finalized — figures and rates locked
            </Badge>
          )}
        </div>
        {/*
         * WHY THE BUTTON ABOVE IS GREYED OUT. A disabled control with no
         * explanation is the same dead end as a 409 nobody reads — the operator's
         * next act is to go and chase a signature, and they can only do that if
         * they are told which agreement is waiting.
         *
         * Named, never counted: "1 agreement outstanding" sends somebody hunting
         * through the Deals tab for it. And since the Deals tab is where they are
         * going, the notice takes them (`UnsignedAgreementsNotice`) — naming the
         * cause without offering the cure is what got this read as a broken
         * screen on 2026-09-01.
         */}
        {settlement.authority.canCompute &&
          !settlement.isFinalized &&
          settlement.unsignedAgreementsNotice && (
            <UnsignedAgreementsNotice
              eventId={settlement.eventId}
              notice={settlement.unsignedAgreementsNotice}
            />
          )}
      </div>

      {settlement.authority.canCompute && <SettlementCurationCard eventId={eventId} />}

      {settlement.parties.length === 0 ? (
        <NothingSettledYet settlement={settlement} />
      ) : (
        <>
          {/*
           * THE DESIGN'S SPLIT ROW: the figures on the left, the conversation and
           * the revision history in a rail on the right.
           *
           * The conversation belongs beside the money and not a tab away from it.
           * Answering a settlement comment MEANS changing a figure — "production
           * line looks 500 higher than our copy" is a remark about one row — and a
           * reader who had to leave the numbers to read it was holding both in
           * their head. `minmax(0, …)` on both columns because the left one
           * carries tables: without it the grid sizes to content and the page
           * scrolls sideways on a laptop (CLAUDE.md, the overflow sweep).
           */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.9fr) minmax(0, 1fr)",
              gap: 20,
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
              <Card padding="lg" style={CARD_COLUMN}>
                <CardTitle subtitle="Read-only preview of the figures entered on Financials. Edit them there.">
                  Revenue &amp; deductions
                </CardTitle>
                {/* EVERY LINE, then the totals — the design's order, and the half
                    that was missing: this card stated that the night deducted
                    33 000 without ever saying what of. */}
                <SettlementLinePreview
                  lines={editor.lines}
                  currency={currency}
                  thread={{
                    forLine: (settlementLineId) =>
                      settlement.comments.filter(
                        (comment) => comment.settlementLineId === settlementLineId,
                      ),
                    post: (message, settlementLineId) =>
                      settlement.postComment(message, settlementLineId),
                  }}
                />
                <PoolLadderRows settlement={settlement} />
              </Card>

              {settlement.parties.map((party) => (
                <SettlementPartyCard key={party.settlementId} party={party} />
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
              <SettlementThread settlement={settlement} />
              <RevisionHistory eventId={eventId} />
            </div>
          </div>

          {/* Sign-off and what leaves the building, side by side — the design's
              closing row. */}
          <div style={TWO_COLUMN}>
            <ApprovalRoster settlement={settlement} />
            <TotalPayouts settlement={settlement} />
          </div>

          {/* "Sending it out" used to sit here, under the roster. It is on the
              Collaborators tab now, where the design puts it and where it sits
              beside each party's position — one copy, because two would be two
              places to change the same list. */}
        </>
      )}

      {settlement.commissions.map((commission) => (
        <Card key={commission.id} padding="lg" style={CARD_COLUMN}>
          <Eyebrow>Agent commission — private to you and your agent</Eyebrow>
          <KeyValueRow
            label={commission.performerLabel}
            value={commission.performerEntitlement}
            mono
          />
          <KeyValueRow
            label={commission.commissionLabel}
            value={commission.commission}
            mono
            total
          />
        </Card>
      ))}

      <ConfirmDialog {...confirmDialog.dialogProps} />
      {sendOpen && (
        <SendForReviewDialog settlement={settlement} onClose={() => setSendOpen(false)} />
      )}
    </div>
  );
}

/**
 * WHO HAS SIGNED OFF — read-only for everyone but yourself.
 *
 * The prototype puts an Approve/Revoke button on every row. The API refuses it:
 * *"You can only confirm your own settlement"*. So the roster reports, and the one
 * row that is yours carries the one signature you may give. There is no revoke —
 * `POST …/confirm` has no inverse, so offering one would be a button that 404s.
 */
function ApprovalRoster({ settlement }: { settlement: EventSettlementData }) {
  return (
    <Card padding="lg" style={CARD_COLUMN}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <CardTitle>Approval Status</CardTitle>
        <Badge
          status={
            settlement.approvedCount === settlement.approvals.length ? "confirmed" : "pending"
          }
        >
          {settlement.approvedCount}/{settlement.approvals.length}
        </Badge>
      </div>
      {/*
       * THE APPROVE BUTTON SITS ON ITS OWN ROW, as the design draws it — a row
       * per party, each with its own control, rather than a badge column and one
       * button underneath.
       *
       * What the design cannot have, and we must: the button is only THERE for a
       * signature this reader may give. The API refuses the rest — *"you can only
       * confirm your own settlement"* — so an Approve on every row would be six
       * buttons of which five 403. An agent holding a delegated performer's
       * authority (decisions.md #14) legitimately has two, which is exactly why
       * the control belongs on the row and not at the foot of the card.
       */}
      {settlement.approvals.map((approval) => (
        <div
          key={approval.participantId}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "10px 14px",
            border: "1px solid var(--border)",
            borderRadius: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>
              {approval.isYours ? `${approval.name} (you)` : approval.name}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              {approval.role}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Badge status={approval.approved ? "confirmed" : "pending"} dot>
              {approval.approved ? "Signed off" : "Pending"}
            </Badge>
            {settlement.authority.canConfirm &&
              approval.signableSettlementId != null &&
              !approval.approved && (
                <Button
                  variant="secondary"
                  disabled={settlement.isBusy}
                  onClick={() => settlement.confirmOwn(approval.signableSettlementId as string)}
                >
                  Approve
                </Button>
              )}
          </div>
        </div>
      ))}
    </Card>
  );
}

/**
 * The pool ladder, the NOT-YET, or the CEILING — three different absences of a
 * figure, and the panel must not tell the reader the wrong one.
 *
 * `ladder` is null in two unrelated situations, and saying "this is the
 * operator's view" in both is how an OPERATOR came to be told it could not see
 * its own event's takings:
 *   - **nothing computed yet** — `ladderOf` reads the ladder off a stored
 *     settlement row, and an event nobody has reconciled has none. Everybody gets
 *     null here, the host included.
 *   - **the ceiling** — the API withholds it from anyone without `budget.view`,
 *     and that is not an empty state to paper over: story.md:44 makes the event's
 *     takings and costs something a performer never sees, "even if an operator
 *     wanted to show them".
 *
 * `parties` separates them. The settlement payload is party-scoped, so a reader
 * who can see at least one settled line is on a reconciled event and a missing
 * ladder there is the ceiling; no lines at all means the reconciliation has not
 * been run, for this reader or anyone.
 */
function PoolLadderRows({ settlement }: { settlement: EventSettlementData }) {
  if (!settlement.ladder) {
    if (settlement.parties.length === 0) {
      return (
        <span className="muted" style={{ display: "flex", gap: 6, fontSize: 12.5 }}>
          <Icon name="receipt" size={14} />
          This event has not been reconciled yet, so there are no takings and costs to show.
        </span>
      );
    }
    return (
      <span className="muted" style={{ display: "flex", gap: 6, fontSize: 12.5 }}>
        <Icon name="eye-off" size={14} />
        The night's takings and costs are the operator's view of this event. Your own settlement,
        and the rule behind every figure in it, is below.
      </span>
    );
  }
  return (
    <>
      {settlement.ladder.map((rung) => (
        <KeyValueRow
          key={rung.key}
          label={rung.label}
          caption={rung.caption}
          value={rung.negative ? `− ${rung.value}` : rung.value}
          mono
          total={rung.total}
          valueColor={rung.negative ? "var(--brand-red)" : undefined}
        />
      ))}
    </>
  );
}

function TicketingSummaryCard({
  revenue,
  visible,
  currency,
}: { revenue: SettlementLineRow[]; visible: boolean; currency: string }) {
  if (!visible) return null;
  const tickets = revenue.filter((line) => line.details?.basis === "ticket_tier");
  if (tickets.length === 0) return null;
  const sold = tickets.reduce((total, line) => total + (line.details?.quantity ?? 0), 0);
  return (
    <Card padding="lg" style={CARD_COLUMN}>
      <CardTitle subtitle="What sold, at what price, and what it came to.">Ticketing</CardTitle>
      {/* MONEY IS FORMATTED, both halves of it.
          `SettlementLineRow` carries MAJOR units as plain strings because it feeds
          the editor's inputs one tab over — rendering those raw put "65000.00"
          beside "SEK 83,000" in the card above and made the same night look like
          two different ledgers. */}
      {tickets.map((line) => (
        <KeyValueRow
          key={line.id}
          label={
            line.details
              ? `${line.label} — ${line.details.quantity} x ${formatMoney(toMinorUnits(line.details.unitAmount), currency)}`
              : line.label
          }
          value={formatMoney(toMinorUnits(line.amount), currency)}
          mono
        />
      ))}
      <KeyValueRow label="Tickets sold" value={String(sold)} mono total />
    </Card>
  );
}

function NothingSettledYet({ settlement }: { settlement: EventSettlementData }) {
  return (
    <EmptyState
      icon={<Icon name="receipt" />}
      title="Nothing settled yet"
      description={
        // An unsigned agreement holds the whole reconciliation shut (decisions.md
        // #21), so the empty state has to say WHY it is empty rather than describe
        // a button that is greyed out three inches above it.
        settlement.authority.canCompute && settlement.unsignedAgreementsNotice
          ? settlement.unsignedAgreementsNotice
          : settlement.authority.canCompute
            ? "Running the settlement reconciles the budget's cash against what each deal entitles its parties to, and works out who owes whom."
            : "Once the operator runs the settlement, your own entitlement and transfers appear here."
      }
    />
  );
}

/**
 * The review conversation — the half of the workflow the 2026-08 meeting names
 * (01:12:54: "the process may involve comments or operator adjustment").
 *
 * Party-scoped by the API, not here: a performer sees their own remarks and the
 * event-side ones, and never another act's. Posting can move the settlement to
 * `comments_received` on its own, because the remark IS the event — which is why
 * there is no "mark as reviewed" button beside it.
 */
function SettlementThread({ settlement }: { settlement: EventSettlementData }) {
  /*
   * THE SETTLEMENT-WIDE REMARKS ONLY.
   *
   * Since the line preview above carries each figure's own thread on its row, a
   * panel that also listed them printed the same sentence twice within a few
   * hundred pixels — which an e2e spec caught by resolving one remark to two
   * elements. A comment anchored to a line belongs beside the line; this panel is
   * for what was said about the settlement as a whole.
   *
   * A comment whose line was later deleted comes back here rather than
   * disappearing: `settlement_line_id` is `set null` on delete precisely so that
   * deleting the figure somebody questioned does not delete the question.
   */
  const general = settlement.comments.filter((comment) => comment.settlementLineId == null);
  const [draft, setDraft] = useState("");
  const send = () => {
    const message = draft.trim();
    if (message === "") return;
    settlement.postComment(message);
    setDraft("");
  };

  return (
    <Card padding="lg" style={{ ...CARD_COLUMN, gap: 12 }}>
      <CardTitle size={17}>Comments</CardTitle>
      {general.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>
          No comments yet. If a figure looks wrong, this is where to say so.
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {general.map((comment) => (
            <div key={comment.id} style={{ display: "flex", gap: 10 }}>
              <Avatar initials={initialsOf(comment.author)} size={30} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13 }}>
                    {comment.isYours ? `${comment.author} (you)` : comment.author}
                  </b>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {formatDay(comment.createdAt)}
                  </span>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 13.5, lineHeight: 1.5 }}>
                  {comment.message}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <TextField
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a comment…"
          style={{ flex: 1 }}
        />
        <Button
          variant="primary"
          disabled={settlement.isBusy || draft.trim() === ""}
          onClick={send}
        >
          Post
        </Button>
      </div>
    </Card>
  );
}

/**
 * What has happened to this settlement, in order.
 *
 * Reads the EVENT ACTIVITY FEED rather than a table of its own. Nothing versions
 * a settlement beyond `settlements.version`, and inventing a `settlement_revisions`
 * table would be a second history to keep in step with the first — the feed
 * already records every act that moves one (`settlement.overridden`,
 * `settlement.confirmed`, `settlement.finalized`, the review transitions, and now
 * `settlement.commented`), and it is already party-scoped by the API, so a
 * performer sees the story of their own settlement and not the operator's whole
 * evening.
 *
 * Filtered to the settlement's own acts: the event feed carries budget edits and
 * invitations too, and this panel answers "what happened to these figures".
 */
function RevisionHistory({ eventId }: { eventId: string }) {
  const activity = useGetApiV1Activity({ eventId });
  const entries = (activity.data?.items ?? []).filter(
    (row) => row.type.startsWith("settlement.") || row.type.startsWith("transfer."),
  );

  return (
    <Card padding="lg" style={{ ...CARD_COLUMN, gap: 10 }}>
      <CardTitle size={17}>Revision history</CardTitle>
      {activity.isPending ? (
        <span className="muted" style={{ fontSize: 13 }}>
          Loading…
        </span>
      ) : entries.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>
          Nothing has happened to these figures yet.
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map((entry) => {
            const described = describeActivity(entry.type, entry.summary);
            return (
              <div key={entry.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--border-strong)",
                    marginTop: 6,
                    flex: "0 0 auto",
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: "var(--text)" }}>{described.title}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {formatDay(entry.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * What leaves the building — the design's "Total Payouts" panel.
 *
 * The operator's own share is RETAINED rather than paid out, so it is excluded and
 * the copy says why. Everything else is a transfer that has to actually happen.
 *
 * Summed from the transfers the caller can see, which is why a performer reads only
 * their own line here: the board above is already party-scoped, and this is the
 * same set totalled. It is a sum of formatted API figures, not arithmetic on money
 * — see `settlementTotalPayable` in the hook.
 */
function TotalPayouts({ settlement }: { settlement: EventSettlementData }) {
  if (settlement.payouts.length === 0) return null;
  return (
    <Card padding="lg" style={CARD_COLUMN}>
      <CardTitle
        subtitle={
          settlement.retainsOwnShare
            ? "As operator your share is retained; below are the amounts payable to the other parties."
            : "What is payable to you on this event."
        }
      >
        Total Payouts
      </CardTitle>
      {settlement.payouts.map((payout) => (
        <KeyValueRow key={payout.key} label={payout.label} value={payout.value} mono />
      ))}
      <KeyValueRow label="Total payable" value={settlement.totalPayable} mono total />
    </Card>
  );
}

/**
 * The FINANCIALS tab — what was PLANNED against what actually happened.
 *
 * The design shows eight editable figures over a live-recomputing payout. In our
 * model those figures are budget lines, and the budget is the PREDICTION while the
 * settlement holds the ACTUALS (`docs/decisions.md` #16.8). So rather than eight
 * inputs that quietly rewrite the plan, this shows the plan and the outcome side
 * by side, per line, with the variance — which is the thing the eight inputs were
 * for and the reason #16.8 exists.
 *
 * Editing still belongs in the Budget Planner, where a budget line is owned. That
 * is one place a figure is changed rather than two that can disagree.
 *
 * `Σ lines[].poolEffect === variance.pool` exactly, so every krona of the variance
 * is attributable to a row — the API asserts it and this screen simply shows it.
 */
/**
 * HOW DO YOU WANT TO ENTER FINANCIALS? — the design's first card on this tab.
 *
 * Offered ONCE, before the settlement has any lines, because after that the
 * question is already answered and re-asking it would be offering to throw away
 * whatever is there.
 *
 * "Start from Budget Planner" is what the platform has always done: the first run
 * takes the settlement's own copy of the forecast, sealed from the planner
 * afterwards. "Start fresh" runs the same reconciliation and copies nothing, so
 * the operator types the night's real figures in. Neither is a mode — nothing
 * remembers the choice, and the first line that exists is what seals the
 * settlement from the budget either way (`lib/settlement-lines.ts`).
 */
function EntryMethodCard({
  settlement,
  hasLines,
}: { settlement: EventSettlementData; hasLines: boolean }) {
  if (!settlement.authority.canCompute || hasLines) return null;
  const blocked = settlement.isBusy || settlement.unsignedAgreementsNotice != null;
  return (
    <Card padding="lg" style={CARD_COLUMN}>
      <CardTitle subtitle="Choose how the revenue and costs get here. You can edit every line afterwards either way.">
        How do you want to enter financials?
      </CardTitle>
      <div style={TWO_COLUMN}>
        <SelectCard
          icon={<Icon name="trending-up" size={18} />}
          title="Start from the Budget Planner"
          description="Takes the settlement's own copy of every forecast line, so you correct figures rather than retype them. Recommended — it is also what gives you planned-vs-actual."
          onSelect={blocked ? undefined : () => settlement.compute()}
        />
        <SelectCard
          icon={<Icon name="pencil" size={18} />}
          title="Start fresh — type the real figures"
          description="Runs the settlement on the agreements alone and copies nothing. For a night whose forecast was never written, or is not worth correcting."
          onSelect={blocked ? undefined : () => settlement.compute({ seedFromBudget: false })}
        />
      </div>
      {/* The affordance the design advertises on the ticket card, said where the
          choice is made — and said honestly. No provider is connected, and
          `packages/settlement/src/ticketing.ts` is the seam one would plug into. */}
      <span
        className="muted"
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
      >
        <Icon name="alert" size={13} />
        Pulling sold counts straight from a ticketing provider is not connected yet — every figure
        here is typed or copied from the plan.
      </span>
    </Card>
  );
}

function FinancialsTab({
  eventId,
  settlement,
  currency,
  onGoToSettlement,
}: {
  eventId: string;
  settlement: EventSettlementData;
  currency: string;
  /** Moves the reader to the tab that actually runs the reconciliation. */
  onGoToSettlement: () => void;
}) {
  const comparison = useGetApiV1EventsIdSettlementPlannedVsActual(eventId);
  // The event's BASE currency, never the cosmetic preview: these inputs are the
  // real figures being recorded, and money.md is explicit that a display currency
  // never touches what is owed. Typing 400 into a EUR-previewed SEK settlement
  // must record 400 SEK.
  const editor = useSettlementLines(eventId, currency);

  if (comparison.isPending) return <LoadingState label="Loading the plan" />;

  // THE ROUTE OUT, DRAWN ABOVE EVERY BRANCH BELOW.
  //
  // Reported 2026-08-31: *"settlement don't work … financials tab doesn't let
  // make the financial settlement."* Both halves of that are the same defect, and
  // neither is the maths. The tab compares plan with outcome; the act that
  // produces the outcome is on the Settlement tab and the figures behind the plan
  // are owned by the Budget Planner (decisions.md #16.8). A reader who came here
  // to settle found a screen that showed money and offered nothing — and when
  // nothing had been computed yet, an empty state with no next move at all.
  //
  // So the locator is unconditional for anyone who could settle, and it carries
  // the act rather than describing it.
  // The chooser below offers the same act with more information behind it, so
  // while it is on screen the locator does not ALSO offer a bare "Run the
  // settlement". Two buttons that do the same thing, one of which quietly picks
  // an answer to a question the other is asking, is worse than either alone.
  const chooserIsShowing = settlement.authority.canCompute && editor.lines.length === 0;
  const guide = settlement.authority.canCompute ? (
    <SettlingHappensHereCard
      eventId={eventId}
      settlement={settlement}
      onGoToSettlement={onGoToSettlement}
      hideRun={chooserIsShowing}
    />
  ) : null;

  // 403 is the ceiling, not a fault: only a party who may read the whole night's
  // money may read the plan behind it.
  if (comparison.isError) {
    return (
      <div style={{ ...CARD_COLUMN, maxWidth: 860 }}>
        {guide}
        <EmptyState
          icon={<Icon name="eye-off" />}
          title="The plan is the operator's view"
          description="What this night was budgeted to make is the whole event's money, not your own line."
        />
      </div>
    );
  }

  const data = comparison.data;
  if (!data.plan) {
    return (
      <div style={{ ...CARD_COLUMN, maxWidth: 860 }}>
        {guide}
        <EntryMethodCard settlement={settlement} hasLines={editor.lines.length > 0} />
        <EmptyState
          icon={<Icon name="trending-up" />}
          title="No plan captured yet"
          description="The budget is snapshotted the first time the settlement is run, and this is where the plan and the outcome are compared."
        />
      </div>
    );
  }

  const rows: { key: string; label: string; planned: string; actual: string; variance: string }[] =
    data.lines.map((line) => ({
      key: line.lineId,
      label: line.label,
      planned: line.planned ? line.planned.amountBase : "—",
      actual: line.actual ? line.actual.amountBase : "—",
      variance: line.variance,
    }));

  return (
    <div style={{ ...CARD_COLUMN, maxWidth: 860 }}>
      {guide}
      <EntryMethodCard settlement={settlement} hasLines={editor.lines.length > 0} />
      {/* Entry first, comparison second: you arrive here to correct a figure, and
          the variance is what you check afterwards. */}
      {settlement.authority.canCompute && (
        <SettlementActualsCard
          editor={editor}
          currency={currency}
          isFinalized={settlement.isFinalized}
          onRecalculate={() => settlement.compute()}
          recalculateBlocked={settlement.unsignedAgreementsNotice != null}
          /* The line-scoped half of the same conversation the Comments tab shows.
             One thread, two ways in: a remark about a figure is made where the
             figure is, and still appears in the tab that lists everything said. */
          thread={{
            forLine: (settlementLineId) =>
              settlement.comments.filter(
                (comment) => comment.settlementLineId === settlementLineId,
              ),
            post: (message, settlementLineId) => settlement.postComment(message, settlementLineId),
          }}
        />
      )}
      <Card padding="lg" style={CARD_COLUMN}>
        <CardTitle subtitle="What this night was budgeted to make, against what it actually did.">
          Planned vs actual
        </CardTitle>
        <PlannedActualRow
          label="Revenue"
          planned={data.plan.revenue}
          actual={data.actual.revenue}
          variance={data.variance?.revenue ?? null}
          currency={data.baseCurrency}
        />
        <PlannedActualRow
          label="Costs"
          planned={data.plan.costs}
          actual={data.actual.costs}
          variance={data.variance?.costs ?? null}
          currency={data.baseCurrency}
        />
        {/* Named as the waterfall names it, so planned-vs-actual and the Overview
            card are talking about the same row. */}
        <PlannedActualRow
          label="Net revenue"
          planned={data.plan.pool}
          actual={data.actual.pool}
          variance={data.variance?.pool ?? null}
          currency={data.baseCurrency}
          emphasis
        />
        {data.actual.withheldBudgetCount > 0 && (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.5 }}>
            {data.actual.withheldBudgetCount} private budget
            {data.actual.withheldBudgetCount === 1 ? " is" : "s are"} not shared with you, so these
            totals are short by whatever they hold.
          </p>
        )}
      </Card>

      {rows.length > 0 && (
        <Card padding="lg" style={CARD_COLUMN}>
          <CardTitle subtitle="Every line that moved, and by how much. These add up to the pool variance above.">
            Line by line
          </CardTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: "0 16px",
              alignItems: "center",
            }}
          >
            <Eyebrow>Line</Eyebrow>
            <Eyebrow style={{ textAlign: "right" }}>Planned</Eyebrow>
            <Eyebrow style={{ textAlign: "right" }}>Actual</Eyebrow>
            <Eyebrow style={{ textAlign: "right" }}>Variance</Eyebrow>
            {rows.map((row) => (
              <FinancialsLine key={row.key} row={row} currency={data.baseCurrency} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * WHERE SETTLING HAPPENS — the card that stops this tab being a dead end.
 *
 * Three things are true at once and the reader could previously see none of them:
 *
 *  1. **The reconciliation is run on the Settlement tab.** It is one act — every
 *     entitlement, every transfer, `Σ net = 0` — and it belongs beside the
 *     document it produces. The button here is that same act, not a second one:
 *     it calls `settlement.compute`, the identical mutation the Settlement tab's
 *     "Run the settlement" calls, so the two can never drift.
 *  2. **A budget figure is changed in the Budget Planner** (decisions.md #16.8).
 *     The budget is the prediction and the settlement holds the actuals; editing
 *     a plan line from two screens is two screens that can disagree about the
 *     same row. So this points at the planner rather than reproducing it —
 *     `?tab=budget`, a real link, because "go and find it" is what sent the
 *     reader round this loop in the first place.
 *  3. **Tonight's actuals are entered right here**, in the card below. That is
 *     what the Financials tab is FOR, and saying so is what makes the other two
 *     read as directions rather than as excuses.
 *
 * The #21 gate is repeated here for the same reason it exists on the Settlement
 * tab: while any agreement on the event is unsigned the API answers 409, so the
 * button is disabled and the refusal is printed by name beside it. A live-looking
 * button that fails every time is worse than no button; a disabled one with no
 * reason is worse than both.
 */
function SettlingHappensHereCard({
  eventId,
  settlement,
  onGoToSettlement,
  hideRun = false,
}: {
  eventId: string;
  settlement: EventSettlementData;
  onGoToSettlement: () => void;
  /** The entry-method card is asking the same question with more in it. */
  hideRun?: boolean;
}) {
  const blocked = settlement.unsignedAgreementsNotice;
  return (
    <Card padding="lg" style={CARD_COLUMN}>
      <CardTitle subtitle="This tab is the plan against the outcome. The two acts behind it live one click away each.">
        Settling this event
      </CardTitle>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!settlement.isFinalized && !hideRun && (
          <Button
            variant={settlement.isComputed ? "secondary" : "primary"}
            disabled={settlement.isBusy || blocked != null}
            leftIcon={<Icon name="receipt" size={14} />}
            onClick={() => settlement.compute()}
          >
            {settlement.isComputed ? "Recalculate the settlement" : "Run the settlement"}
          </Button>
        )}
        <Button
          variant="secondary"
          rightIcon={<Icon name="chevron-right" size={14} />}
          onClick={onGoToSettlement}
        >
          Open the Settlement tab
        </Button>
        {/* NAMED FOR WHERE IT GOES, not for what it does to the money here.
            "Edit the budget" on a settlement screen reads as an offer to change
            the settlement — which is the objection raised on 2026-09-01: *"for
            some reason Settlement has an 'Edit the budget' button… the point was
            that budget is the plan and Settlement is the actual"*. It never did
            that; it is a link to the planner, where the FORECAST is owned. So it
            says the planner's own name, and the paragraph below says which half
            of the comparison lives where. */}
        <Link to="/events/$eventId" params={{ eventId }} search={{ tab: "budget" }}>
          <Button variant="ghost" leftIcon={<Icon name="pencil" size={14} />}>
            Open the Budget Planner
          </Button>
        </Link>
      </div>
      {blocked ? (
        <UnsignedAgreementsNotice eventId={eventId} notice={blocked} />
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
          Running it recomputes every party's entitlement and the transfers between them; the
          Settlement tab is where those figures, the approvals and the review conversation live.
          What each line was BUDGETED to be is owned by the Budget Planner and changed there — what
          it actually came to is entered below.
        </p>
      )}
    </Card>
  );
}

/** One plan-vs-outcome row, with the variance signed and coloured. */
function PlannedActualRow({
  label,
  planned,
  actual,
  variance,
  currency,
  emphasis,
}: {
  label: string;
  planned: string;
  actual: string;
  variance: string | null;
  currency: string;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto",
        gap: "0 16px",
        alignItems: "center",
        padding: "9px 0",
        borderTop: "1px solid var(--border)",
        fontWeight: emphasis ? 600 : 400,
      }}
    >
      <span style={{ fontSize: 13.5 }}>{label}</span>
      <MoneyCell value={planned} currency={currency} muted />
      <MoneyCell value={actual} currency={currency} />
      <VarianceCell value={variance} currency={currency} />
    </div>
  );
}

function FinancialsLine({
  row,
  currency,
}: {
  row: { label: string; planned: string; actual: string; variance: string };
  currency: string;
}) {
  return (
    <>
      <span
        style={{
          fontSize: 13,
          padding: "7px 0",
          borderTop: "1px solid var(--border)",
          minWidth: 0,
        }}
      >
        {row.label}
      </span>
      <MoneyCell value={row.planned} currency={currency} muted bordered />
      <MoneyCell value={row.actual} currency={currency} bordered />
      <VarianceCell value={row.variance} currency={currency} bordered />
    </>
  );
}

function MoneyCell({
  value,
  currency,
  muted,
  bordered,
}: { value: string; currency: string; muted?: boolean; bordered?: boolean }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        textAlign: "right",
        whiteSpace: "nowrap",
        color: muted ? "var(--muted)" : "var(--text)",
        padding: bordered ? "7px 0" : 0,
        borderTop: bordered ? "1px solid var(--border)" : undefined,
      }}
    >
      {value === "—" ? value : formatMoney(value, currency)}
    </span>
  );
}

/**
 * A variance, signed. Over budget on a COST and under on revenue are both bad news,
 * but the sign is the honest thing to show — the reader knows which line they are
 * looking at, and a screen that editorialises about direction gets it wrong the
 * first time somebody books a cost as negative revenue.
 */
function VarianceCell({
  value,
  currency,
  bordered,
}: { value: string | null; currency: string; bordered?: boolean }) {
  const style = {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    textAlign: "right" as const,
    whiteSpace: "nowrap" as const,
    padding: bordered ? "7px 0" : 0,
    borderTop: bordered ? "1px solid var(--border)" : undefined,
  };
  if (value == null) return <span style={{ ...style, color: "var(--dim)" }}>—</span>;
  const negative = value.startsWith("-");
  return (
    <span style={{ ...style, color: negative ? "var(--brand-red)" : "var(--text)" }}>
      {negative
        ? `− ${formatMoney(value.slice(1), currency)}`
        : `+ ${formatMoney(value, currency)}`}
    </span>
  );
}

/**
 * The PAYOUT tab.
 *
 * Gated on finalize, exactly as the design has it: figures that can still move are
 * not figures you pay against. The payment rail itself is not wired yet — that is
 * Stripe, and it comes later — so the button says what it will do and is disabled
 * until it can do it, rather than being a live-looking control that silently does
 * nothing.
 */
function PayoutTab({ settlement }: { settlement: EventSettlementData }) {
  const lines: SettlementLine[] = settlement.parties
    .filter((party) => party.entitlement != null)
    .map((party) => ({
      id: party.settlementId,
      party: party.isYours ? `${party.name} (you)` : party.name,
      initials: party.initials,
      owed: party.entitlement as string,
      collected: party.collected as string,
      paid: party.paid as string,
      prepaid: party.prepaid,
      prepaidLabel: party.prepaidLabel,
      net: party.net as string,
      netTone: party.netTone,
    }));

  if (!settlement.isComputed) return <NothingSettledYet settlement={settlement} />;

  if (!settlement.isFinalized) {
    return (
      <Card padding="lg" style={{ ...CARD_COLUMN, alignItems: "center", textAlign: "center" }}>
        {/* A LOCK, as the design draws it. An alert triangle says something is
            wrong; nothing is wrong here — the settlement simply is not final yet,
            and the difference matters to an operator deciding whether to worry. */}
        <Icon name="lock" size={30} style={{ color: "var(--brand-amber)" }} />
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 18 }}>
          Payouts are locked
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5, maxWidth: 420 }}>
          This settlement is {settlementStatusToDisplay(settlement.status).label.toLowerCase()}.
          Finalize it before processing payouts.
        </p>
        <Button variant="primary" disabled>
          Process payout
        </Button>
      </Card>
    );
  }

  return (
    <div style={{ ...CARD_COLUMN, maxWidth: 900 }}>
      <TotalPayouts settlement={settlement} />
      {/*
       * WHO OWES WHOM, and the transfers themselves — moved here on 2026-09-15.
       *
       * It used to sit on the Settlement tab, which the design keeps for what the
       * night came to and who agreed it. This is the paying: a board of net
       * positions and a row per transfer with "mark as paid" on it, which is what
       * this tab is named after. The design has no equivalent card, and the
       * mechanism is ours rather than an invention — the transfers are what moves
       * a settlement to partly paid and then paid.
       */}
      <WhoOwesWhomBoard
        participants={lines}
        transfers={settlement.transfers}
        variant={lines.length > 1 ? "full" : "slice"}
        // Claimed only when the visible lines really do sum to zero: a
        // party-scoped slice is short by the lines the caller may not see,
        // and "Not balanced" over a redaction reports authorization as an
        // accounting error.
        balanced={settlement.isWholeBoard ? true : undefined}
        onMark={settlement.isBusy ? undefined : settlement.markTransfer}
      />
      {!settlement.isWholeBoard && (
        <span
          className="muted"
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
        >
          <Icon name="eye-off" size={13} />
          Your own line. The other parties' figures on this event aren't shared with you.
        </span>
      )}
      <Card padding="lg" style={CARD_COLUMN}>
        <CardTitle>Process Payouts</CardTitle>
        <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
          Paying out through shoWMe is not connected yet. Until it is, mark each transfer on the
          Settlement tab as you pay it — that is what moves this settlement to partly paid and then
          paid.
        </p>
        <div>
          <Button variant="primary" disabled>
            Process payout
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * The review conversation, on its own tab.
 *
 * The design keeps this in a sticky rail beside the figures. Moved out at the
 * owner's request: the settlement is long, the rail could only ever show a few
 * remarks before scrolling inside itself, and giving the thread the full width
 * lets a discussion actually be read. The figures get the whole Settlement tab in
 * return.
 *
 * The two belong together — a remark and the revision it caused are one story —
 * so they share the tab rather than becoming two.
 */
