import {
  type getApiV1EventsId,
  useGetApiV1Activity,
  useGetApiV1EventsId,
} from "@showme/api-client";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  KeyValueRow,
  Tabs,
  TextField,
} from "@showme/design-system";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDialog, useConfirmDialog } from "../components/ConfirmDialog";
import { SettlementPartyCard } from "../components/SettlementPartyCard";
import { SettlementStepper } from "../components/SettlementStepper";
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
  type SettlementParty,
  useEventSettlement,
} from "../components/useEventSettlement";
import { formatDate } from "../lib/format";
import { apiStatusToDisplay } from "../lib/status";

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
 * Three tabs, not the prototype's five. **Financials** and **Payout** are absent
 * because neither has a backend: the editable revenue figures the design shows are
 * budget lines in our model and need the budget snapshot of `decisions.md` #16.8
 * (unbuilt, needs a migration), and there is no payouts mechanism at all — there
 * is deliberately no escrow. Rendering either would be a dead affordance
 * (STYLE-GUIDE §7).
 *
 * Every figure on screen is a field the API served, formatted by the hook. The
 * browser does no money arithmetic.
 */
export function EventSettlement() {
  const { eventId } = useParams({ from: "/events/$eventId/settlement" });
  const [tab, setTab] = useState("overview");
  const event = useGetApiV1EventsId(eventId);
  const settlement = useEventSettlement(
    eventId,
    event.data?.capabilities ?? [],
    event.data?.baseCurrency ?? "",
  );

  if (event.isPending) return <LoadingState label="Loading settlement" />;
  if (event.isError) return <ErrorState error={event.error} title="Couldn't load this event" />;

  const eventStatus = apiStatusToDisplay(event.data.status);
  const status = settlementStatusToDisplay(settlement.status);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1180 }}>
      <div>
        <Link
          to="/events/$eventId"
          params={{ eventId }}
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
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            {/* The design puts the city here ("Funkhaus · Berlin · Jul 04"). The
                event payload carries no city of its own — it lives on the venue
                PROFILE — so the line renders what it has rather than a blank
                separator, and gains the city when the event serves one. */}
            {[event.data.venueName, formatDate(event.data.eventDate)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Badge status={eventStatus.status} dot>
            {eventStatus.label}
          </Badge>
          <Badge status={status.status} dot>
            {status.label}
          </Badge>
          {/* A POINTER to the PRO filing, which lives on its own screen — royalties
              are a different money stream and never enter this page's Σ net = 0.
              Shown only to someone who could actually file. */}
          {(event.data.capabilities ?? []).includes("performance_report.file") && (
            <Link to="/reports">
              <Button variant="secondary" leftIcon={<Icon name="trending-up" size={14} />}>
                Report to PRO
              </Button>
            </Link>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "deals", label: "Deal Structure" },
          { key: "financials", label: "Financials" },
          { key: "settlement", label: "Settlement" },
          { key: "comments", label: "Comments" },
          { key: "payout", label: "Payout" },
        ]}
      />

      {settlement.isPending ? (
        <LoadingState label="Loading settlement" />
      ) : settlement.isError ? (
        <ErrorState error={settlement.error} title="Couldn't load the settlement" />
      ) : tab === "overview" ? (
        <OverviewTab event={event.data} settlement={settlement} />
      ) : tab === "deals" ? (
        <DealStructureTab settlement={settlement} />
      ) : tab === "financials" ? (
        <FinancialsTab settlement={settlement} />
      ) : tab === "comments" ? (
        <CommentsTab settlement={settlement} eventId={eventId} />
      ) : tab === "payout" ? (
        <PayoutTab settlement={settlement} />
      ) : (
        <SettlementTab settlement={settlement} />
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
  return (
    <div style={CARD_COLUMN}>
      <div style={TWO_COLUMN}>
        <Card padding="lg" style={CARD_COLUMN}>
          <CardTitle>Event Details</CardTitle>
          <KeyValueRow label="Date" value={formatDate(event.eventDate)} />
          <KeyValueRow label="Venue" value={event.venueName ?? "Not set"} />
          <KeyValueRow
            label="Capacity"
            value={event.capacity != null ? String(event.capacity) : "Not set"}
          />
          <KeyValueRow label="Event status" value={eventStatus.label} />
          <KeyValueRow label="Settles in" value={event.baseCurrency} mono />
        </Card>

        <Card padding="lg" style={CARD_COLUMN}>
          <CardTitle>Financial Overview</CardTitle>
          <PoolLadderRows settlement={settlement} />
          {settlement.ownParty?.entitlement && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <Eyebrow>Your settlement</Eyebrow>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 600,
                  color: "var(--brand-red)",
                  marginTop: 4,
                }}
              >
                {settlement.ownParty.entitlement}
              </div>
            </div>
          )}
        </Card>
      </div>

      {settlement.parties.length === 0 ? (
        <NothingSettledYet settlement={settlement} />
      ) : (
        <div style={CARD_COLUMN}>
          {settlement.parties.map((party) => (
            <Card
              key={party.settlementId}
              padding="lg"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <PartyIdentity party={party} />
              <span style={{ fontSize: 22, fontWeight: 500, color: "var(--brand-gold)" }}>
                {party.entitlement ?? "Not reconciled yet"}
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DealStructureTab({ settlement }: { settlement: EventSettlementData }) {
  if (settlement.deals.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="receipt" />}
        title="No settled agreement to show"
        description="A deal appears here once the settlement has been run and the engine has recorded what the agreement paid."
      />
    );
  }
  return (
    <div style={CARD_COLUMN}>
      {settlement.deals.map((deal) => (
        <Card key={deal.dealId} padding="lg" style={{ ...CARD_COLUMN, maxWidth: 660 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            {/* The deal's own name only. Its STRUCTURE is stated more precisely,
                and per party, by the rule sentence under each share below. */}
            <span style={{ fontWeight: 600 }}>{deal.name}</span>
          </div>
          <KeyValueRow label="What the agreement paid" value={deal.dealTotal} mono total />
          {deal.shares.map((share) => (
            <KeyValueRow
              key={share.key}
              label={
                <span>
                  {share.name}
                  <span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>
                    {share.rule}
                  </span>
                </span>
              }
              value={share.amount}
              mono
            />
          ))}
        </Card>
      ))}
    </div>
  );
}

function SettlementTab({ settlement }: { settlement: EventSettlementData }) {
  const confirmDialog = useConfirmDialog();
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

  const lines: SettlementLine[] = settlement.parties
    .filter((party) => party.entitlement != null)
    .map((party) => ({
      id: party.settlementId,
      party: party.isYours ? `${party.name} (you)` : party.name,
      initials: party.initials,
      owed: party.entitlement as string,
      collected: party.collected as string,
      paid: party.paid as string,
      net: party.net as string,
      netTone: party.netTone,
    }));

  return (
    <div style={CARD_COLUMN}>
      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* The design runs the rail the full width of the card. Seven stops need
            it — the stepper grows its connectors to fill whatever it is given. */}
        <div>
          <SettlementStepper steps={settlementSteps(settlement.status)} />
        </div>
        {/*
         * The design shows THREE actions, chosen by status, not every action at
         * once — "Add revision · Mark finalized · Flag dispute" on a settlement
         * under review. A row of five buttons asks the reader to work out which
         * one they want; a row of two or three tells them.
         *
         * So: recalculating is offered only before the figures are sent out, and
         * re-issuing only after they have come back. Finalize and dispute keep
         * their own conditions.
         */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {settlement.authority.canCompute &&
            !settlement.isFinalized &&
            (!settlement.isComputed || settlement.status === "open") && (
              <Button
                variant={settlement.isComputed ? "secondary" : "primary"}
                disabled={settlement.isBusy}
                leftIcon={<Icon name="receipt" size={14} />}
                onClick={settlement.compute}
              >
                {settlement.isComputed ? "Recalculate" : "Run the settlement"}
              </Button>
            )}
          {settlement.authority.canFinalize && settlement.isComputed && !settlement.isFinalized && (
            <Button variant="primary" disabled={settlement.isBusy} onClick={askToFinalize}>
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
                onClick={settlement.sendForReview}
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
      </Card>

      {settlement.parties.length === 0 ? (
        <NothingSettledYet settlement={settlement} />
      ) : (
        <>
          {/* Full width. The design splits this row, with the conversation in a
              sticky rail beside the figures — but the conversation now has a tab
              of its own, so nothing is competing for the space and the money gets
              all of it. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            <>
              <Card padding="lg" style={CARD_COLUMN}>
                <CardTitle subtitle="What the night took, what it cost, and the net every percentage below is a share of.">
                  Revenue &amp; deductions
                </CardTitle>
                <PoolLadderRows settlement={settlement} />
              </Card>

              {settlement.parties.map((party) => (
                <SettlementPartyCard key={party.settlementId} party={party} />
              ))}

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
            </>
          </div>

          {/* Sign-off and what leaves the building, side by side — the design's
              closing row. */}
          <div style={TWO_COLUMN}>
            <ApprovalRoster settlement={settlement} />
            <TotalPayouts settlement={settlement} />
          </div>
        </>
      )}

      {settlement.commissions.map((commission) => (
        <Card key={commission.id} padding="lg" style={CARD_COLUMN}>
          <Eyebrow>Agent commission — private to you and your agent</Eyebrow>
          <KeyValueRow
            label={`${settlement.nameOf(commission.performerParticipantId)} entitlement`}
            value={commission.performerEntitlement}
            mono
          />
          <KeyValueRow
            label={`Commission to ${settlement.nameOf(commission.agentParticipantId)}`}
            value={commission.commission}
            mono
            total
          />
        </Card>
      ))}

      <ConfirmDialog {...confirmDialog.dialogProps} />
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
  const own = settlement.ownParty;
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
      {settlement.approvals.map((approval) => (
        <KeyValueRow
          key={approval.participantId}
          label={
            <span>
              {approval.isYours ? `${approval.name} (you)` : approval.name}
              <span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>
                {approval.role}
              </span>
            </span>
          }
          value={
            <Badge status={approval.approved ? "confirmed" : "pending"} dot>
              {approval.approved ? "Signed off" : "Pending"}
            </Badge>
          }
        />
      ))}
      {own && settlement.authority.canConfirm && !own.approvedByYou && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text)", fontSize: 13 }}>
            Do these figures match your books?
          </span>
          <span style={{ flex: 1 }} />
          <Button
            variant="primary"
            disabled={settlement.isBusy}
            leftIcon={<Icon name="check" size={14} />}
            onClick={() => settlement.confirmOwn(own.settlementId)}
          >
            Sign off on my settlement
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * The pool ladder, or the CEILING stated plainly.
 *
 * `ladder` is null for anyone without `budget.view`, and that is not an empty
 * state to paper over: story.md:44 makes the event's takings and costs something a
 * performer never sees, "even if an operator wanted to show them". So the panel
 * says whose view it is rather than rendering a row of dashes that reads like a
 * loading failure.
 */
function PoolLadderRows({ settlement }: { settlement: EventSettlementData }) {
  if (!settlement.ladder) {
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
          value={rung.negative ? `− ${rung.value}` : rung.value}
          mono
          total={rung.total}
          valueColor={rung.negative ? "var(--brand-red)" : undefined}
        />
      ))}
    </>
  );
}

function PartyIdentity({ party }: { party: SettlementParty }) {
  return (
    <div>
      <span style={{ fontWeight: 600 }}>{party.isYours ? `${party.name} (you)` : party.name}</span>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{party.role}</div>
    </div>
  );
}

function NothingSettledYet({ settlement }: { settlement: EventSettlementData }) {
  return (
    <EmptyState
      icon={<Icon name="receipt" />}
      title="Nothing settled yet"
      description={
        settlement.authority.canCompute
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
      {settlement.comments.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>
          No comments yet. If a figure looks wrong, this is where to say so.
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {settlement.comments.map((comment) => (
            <div key={comment.id} style={{ display: "flex", gap: 10 }}>
              <Avatar initials={initialsOf(comment.author)} size={30} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13 }}>
                    {comment.isYours ? `${comment.author} (you)` : comment.author}
                  </b>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {formatDate(comment.createdAt)}
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
                    {formatDate(entry.createdAt)}
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
 * The FINANCIALS tab — where the night's takings and costs are entered.
 *
 * The design shows eight editable figures over a live-recomputing payout, and that
 * is the manual-override surface the 2026-08 meeting asks for. In OUR model those
 * eight are budget lines, and editing them at settlement time is what
 * `docs/decisions.md` #16.8 (budget snapshot) exists to make safe — budgets are the
 * PREDICTION, the settlement holds the ACTUALS, and the snapshot is what keeps
 * planned-vs-actual after the fact.
 *
 * Until that lands the ladder is shown READ-ONLY, which is the same information the
 * engine already computed, rather than eight inputs that would quietly write to the
 * plan. The note says so on screen rather than leaving a reader to discover it.
 */
function FinancialsTab({ settlement }: { settlement: EventSettlementData }) {
  if (!settlement.isComputed) return <NothingSettledYet settlement={settlement} />;
  return (
    <div style={{ ...CARD_COLUMN, maxWidth: 660 }}>
      <Card padding="lg" style={CARD_COLUMN}>
        <CardTitle>Revenue & deductions</CardTitle>
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
          These are the figures the settlement was computed from. Editing them here — with every
          payout recomputing live — arrives with the budget snapshot, so that correcting an actual
          cannot quietly rewrite the plan it was measured against.
        </p>
        <PoolLadderRows settlement={settlement} />
      </Card>
    </div>
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
  if (!settlement.isComputed) return <NothingSettledYet settlement={settlement} />;

  if (!settlement.isFinalized) {
    return (
      <Card padding="lg" style={{ ...CARD_COLUMN, alignItems: "center", textAlign: "center" }}>
        <Icon name="alert" size={30} style={{ color: "var(--brand-amber)" }} />
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
    <div style={{ ...CARD_COLUMN, maxWidth: 660 }}>
      <TotalPayouts settlement={settlement} />
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
function CommentsTab({
  settlement,
  eventId,
}: { settlement: EventSettlementData; eventId: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SettlementThread settlement={settlement} />
      <RevisionHistory eventId={eventId} />
    </div>
  );
}
