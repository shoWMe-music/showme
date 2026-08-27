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
import { Eyebrow } from "../components/primitives";
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
          <h2 style={{ margin: "6px 0", fontSize: 28, letterSpacing: "-0.025em" }}>
            {event.data.title}
          </h2>
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
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
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "deals", label: "Deal Structure" },
          { key: "settlement", label: "Settlement" },
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
      ) : (
        <SettlementTab settlement={settlement} eventId={eventId} />
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
          <Eyebrow>Event details</Eyebrow>
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
          <Eyebrow>Financial overview</Eyebrow>
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

function SettlementTab({
  settlement,
  eventId,
}: { settlement: EventSettlementData; eventId: string }) {
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
        {/* Bounded: the stepper grows its connector to fill whatever it is given,
            so left unbounded the stops sit at opposite ends of a 1180px page
            joined by a rule. Five stops need more room than two did. */}
        <div style={{ maxWidth: 560 }}>
          <SettlementStepper steps={settlementSteps(settlement.status)} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {settlement.authority.canCompute && !settlement.isFinalized && (
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
                Re-issue figures
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
          <Card padding="lg" style={{ ...CARD_COLUMN, maxWidth: 660 }}>
            <Eyebrow>Revenue and deductions</Eyebrow>
            <PoolLadderRows settlement={settlement} />
          </Card>

          <div style={CARD_COLUMN}>
            {settlement.parties.map((party) => (
              <SettlementPartyCard key={party.settlementId} party={party} />
            ))}
          </div>

          <WhoOwesWhomBoard
            participants={lines}
            transfers={settlement.transfers}
            variant={lines.length > 1 ? "full" : "slice"}
            // Claimed only when the visible lines really do sum to zero: a
            // party-scoped slice is short by the lines the caller may not see, and
            // "Not balanced" over a redaction reports authorization as an
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

          <SettlementThread settlement={settlement} />
          <RevisionHistory eventId={eventId} />
          <ApprovalRoster settlement={settlement} />
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
        <Eyebrow>Approval status</Eyebrow>
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
      <Eyebrow>Comments</Eyebrow>
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
      <Eyebrow>Revision history</Eyebrow>
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
