import type { getApiV1EventsIdParticipants } from "@showme/api-client";
import { Badge, Button, Card, EmptyState, Icon, KeyValueRow } from "@showme/design-system";
import { formatMoney } from "../lib/format";
import { ConfirmDialog, useConfirmDialog } from "./ConfirmDialog";
import { SettlementStepper } from "./SettlementStepper";
import { type SettlementLine, type Transfer, WhoOwesWhomBoard } from "./WhoOwesWhomBoard";
import { Eyebrow } from "./primitives";
import {
  initialsOf,
  isWholeBoard,
  netToneOf,
  settlementSteps,
  transferStateOf,
} from "./settlementDocument";
import { ErrorState, LoadingState } from "./states";
import { useEventSettlement } from "./useEventSettlement";

type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];

export interface EventSettlementTabProps {
  eventId: string;
  /** The event's base currency — every settled figure is denominated in it. */
  currency: string;
  roster: Participant[];
  /** The caller's own effective capabilities on this event. */
  capabilities: readonly string[];
}

/**
 * The Settlement tab: run the reconciliation, read the board, record what was
 * paid, and — for the operator who holds it — freeze the result.
 *
 * Nothing here does money arithmetic. The engine (`packages/settlement`) is
 * authoritative and every figure on screen is a field the API served; a second
 * implementation in the browser is exactly the drift the audit found once already.
 */
export function EventSettlementTab({
  eventId,
  currency,
  roster,
  capabilities,
}: EventSettlementTabProps) {
  const settlement = useEventSettlement(eventId, capabilities);
  const confirmDialog = useConfirmDialog();

  if (settlement.isPending) return <LoadingState label="Loading settlement" />;
  if (settlement.isError) {
    return <ErrorState error={settlement.error} title="Couldn't load the settlement" />;
  }

  const nameFor = (participantId: string | null | undefined): string => {
    const match = roster.find((party) => party.id === participantId);
    if (!match) return "Participant";
    return match.name ?? match.performerTag ?? match.role.replace(/_/g, " ");
  };

  const computedRows = settlement.settlements.filter((row) => row.computed != null);
  const lines: SettlementLine[] = computedRows.map((row) => {
    const computed = row.computed as NonNullable<typeof row.computed>;
    const party = nameFor(row.participantId);
    return {
      id: row.id,
      party,
      initials: initialsOf(party),
      owed: formatMoney(computed.entitlement, currency),
      collected: formatMoney(computed.collected, currency),
      paid: formatMoney(computed.paid, currency),
      net: formatMoney(computed.net, currency),
      netTone: netToneOf(computed.net),
    };
  });

  const transfers: Transfer[] = settlement.transfers
    // A representation transfer is the private agent commission — it belongs with
    // the commission card below, not among the event's who-owes-whom lines (#14).
    .filter((transfer) => !transfer.representationId)
    .map((transfer, index) => ({
      id: transfer.id ?? `transfer-${index}`,
      from: nameFor(transfer.fromParticipantId),
      to: nameFor(transfer.toParticipantId),
      amount: formatMoney(transfer.amount, currency),
      state: transferStateOf(transfer.state),
    }));

  const wholeBoard = isWholeBoard(computedRows.map((row) => row.computed?.net ?? "0"));
  const ownLine = settlement.settlements.find((row) => row.isYours);

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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Eyebrow>Settlement</Eyebrow>
            {settlement.isFinalized && (
              <Badge status="confirmed" dot>
                Finalized — figures and rates locked
              </Badge>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
            {settlement.authority.canFinalize &&
              settlement.isComputed &&
              !settlement.isFinalized && (
                <Button variant="primary" disabled={settlement.isBusy} onClick={askToFinalize}>
                  Finalize
                </Button>
              )}
          </div>
        </div>
        <SettlementStepper steps={settlementSteps(settlement.settlements[0]?.status ?? "open")} />
      </Card>

      {computedRows.length === 0 ? (
        <EmptyState
          icon={<Icon name="receipt" />}
          title="Nothing settled yet"
          description={
            settlement.authority.canCompute
              ? "Running the settlement reconciles the budget's cash against what each deal entitles its parties to, and works out who owes whom."
              : "Once the operator runs the settlement, your own entitlement and transfers appear here."
          }
        />
      ) : (
        <>
          <WhoOwesWhomBoard
            participants={lines}
            transfers={transfers}
            variant={lines.length > 1 ? "full" : "slice"}
            // Claimed only when the visible lines really do sum to zero: a
            // party-scoped slice is short by the lines the caller may not see, and
            // "Not balanced" over a redaction reports authorization as an
            // accounting error.
            balanced={wholeBoard ? true : undefined}
            onMark={settlement.isBusy ? undefined : settlement.markTransfer}
          />
          {!wholeBoard && (
            <span
              className="muted"
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
            >
              <Icon name="eye-off" size={13} />
              Your own line. The other parties' figures on this event aren't shared with you.
            </span>
          )}
          {ownLine && settlement.authority.canConfirm && (
            <OwnSettlementSignOff
              approved={ownLine.approvedByYou}
              busy={settlement.isBusy}
              onConfirm={() => settlement.confirmOwn(ownLine.id)}
            />
          )}
        </>
      )}

      {settlement.commissions.map((commission) => (
        <Card
          key={commission.id}
          padding="lg"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <Eyebrow>Agent commission — private to you and your agent</Eyebrow>
          <KeyValueRow
            label={`${nameFor(commission.performerParticipantId)} entitlement`}
            value={formatMoney(commission.performerEntitlement, currency)}
            mono
          />
          <KeyValueRow
            label={`Commission to ${nameFor(commission.agentParticipantId)}`}
            value={formatMoney(commission.commission, currency)}
            mono
            total
          />
          <KeyValueRow
            label="Payout collected by"
            value={
              commission.agentCollects
                ? nameFor(commission.agentParticipantId)
                : nameFor(commission.performerParticipantId)
            }
          />
        </Card>
      ))}

      <ConfirmDialog {...confirmDialog.dialogProps} />
    </div>
  );
}

/**
 * The caller signing off on their own settlement line — the one step in the
 * settlement that is a decision rather than a calculation. Only ever their own:
 * the API refuses any other id ("You can only confirm your own settlement"), so
 * there is deliberately no control for approving on somebody else's behalf.
 */
function OwnSettlementSignOff({
  approved,
  busy,
  onConfirm,
}: { approved: boolean; busy: boolean; onConfirm: () => void }) {
  return (
    <Card padding="md" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ color: "var(--text)", fontSize: 13 }}>
        {approved
          ? "You have signed off on your settlement."
          : "Do these figures match your books?"}
      </span>
      <span style={{ flex: 1 }} />
      {approved ? (
        <Badge status="confirmed" dot>
          Signed off
        </Badge>
      ) : (
        <Button
          variant="primary"
          disabled={busy}
          leftIcon={<Icon name="check" size={14} />}
          onClick={onConfirm}
        >
          Sign off on my settlement
        </Button>
      )}
    </Card>
  );
}
