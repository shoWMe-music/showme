import {
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdSettlements,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdSettlements,
} from "@showme/api-client";
import { Badge, Button, Card, Icon, KeyValueRow, Modal } from "@showme/design-system";
import { formatDate, formatMoney } from "../lib/format";
import { apiStatusToDisplay } from "../lib/status";
import { SettlementStepper } from "./SettlementStepper";
import { type SettlementLine, type Transfer, WhoOwesWhomBoard } from "./WhoOwesWhomBoard";
import { Eyebrow } from "./primitives";
import {
  type SettlementListRow,
  initialsOf,
  isWholeBoard,
  netToneOf,
  settlementStatusToDisplay,
  settlementSteps,
  transferStateOf,
} from "./settlementDocument";
import { ErrorState, LoadingState } from "./states";

type EventSettlements = Awaited<ReturnType<typeof getApiV1EventsIdSettlements>>;
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];

/**
 * One event's settlement, opened from a row on the Settlements screen.
 *
 * A modal rather than a routed page, matching the invoice document: a settlement
 * is a leaf record with no sub-navigation, and keeping it over the list preserves
 * the filter chip and scroll position behind it. (The event workspace has its own
 * Settlement tab; this is the same board reached from the money screen, for people
 * whose entry point is "what am I owed" rather than "how did that show go".)
 *
 * It renders ONLY what `GET /events/:id/settlements` returns. That payload is
 * already party-scoped by the server (`apps/api/src/serialize/settlement.ts` plus
 * the route's `partiesVisibleTo` join): the operator, as the deal's payer, gets
 * every party's line; a performer gets her own and nothing else. So this component
 * must never assume the operator's shape — it renders however many lines arrived.
 */
export function SettlementDetailModal({
  settlement,
  onClose,
}: { settlement: SettlementListRow | null; onClose: () => void }) {
  const eventId = settlement?.event.id ?? "";
  const enabled = Boolean(eventId);

  const { data, isPending, isError, error } = useGetApiV1EventsIdSettlements(eventId, {
    query: { enabled },
  });
  // Names only. The board is readable without them (ids fall back to a stub), so a
  // caller whose permission set stops short of the roster still sees their money.
  const roster = useGetApiV1EventsIdParticipants(eventId, { query: { enabled } });

  const status = settlement ? settlementStatusToDisplay(settlement.status) : null;
  const eventStatus = settlement ? apiStatusToDisplay(settlement.event.status) : null;

  return (
    <Modal
      open={Boolean(settlement)}
      onClose={onClose}
      title={settlement ? settlement.event.title : "Settlement"}
      width={720}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {settlement && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Eyebrow>{formatDate(settlement.event.eventDate)}</Eyebrow>
            {eventStatus && (
              <Badge status={eventStatus.status} dot>
                {eventStatus.label}
              </Badge>
            )}
            {status && (
              <Badge status={status.status} dot>
                {status.label}
              </Badge>
            )}
          </div>

          <Card padding="lg">
            <SettlementStepper steps={settlementSteps(settlement.status)} />
          </Card>

          {isPending ? (
            <LoadingState label="Loading settlement" />
          ) : isError ? (
            <ErrorState error={error} title="Couldn't load this settlement" />
          ) : (
            <SettlementBoard
              data={data}
              currency={settlement.currency}
              ownParticipantId={settlement.participantId}
              roster={roster.data ?? []}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function SettlementBoard({
  data,
  currency,
  ownParticipantId,
  roster,
}: {
  data: EventSettlements;
  currency: string;
  ownParticipantId: string | null;
  roster: Participant[];
}) {
  const nameFor = (participantId: string | null | undefined): string => {
    const match = roster.find((party) => party.id === participantId);
    if (match?.name) return match.name;
    // No roster name to hand: the short id is honest where an invented label
    // ("Participant 2") would not be.
    return participantId ? participantId.slice(0, 8) : "Participant";
  };
  const label = (participantId: string | null | undefined): string =>
    participantId && participantId === ownParticipantId
      ? `${nameFor(participantId)} (you)`
      : nameFor(participantId);

  // Only the party-scoped settlements carry a breakdown; a representation-scoped
  // row is shaped differently and is surfaced separately below.
  const lines: SettlementLine[] = data.settlements
    .filter((row) => row.computed != null)
    .map((row) => {
      const computed = row.computed as NonNullable<typeof row.computed>;
      const party = label(row.participantId);
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

  const transfers: Transfer[] = data.transfers
    // A representation transfer is the private agent commission — it belongs with
    // the commission card, not among the event's who-owes-whom lines.
    .filter((transfer) => !transfer.representationId)
    .map((transfer, index) => ({
      id: transfer.id ?? `transfer-${index}`,
      from: label(transfer.fromParticipantId),
      to: label(transfer.toParticipantId),
      amount: formatMoney(transfer.amount, currency),
      state: transferStateOf(transfer.state),
    }));

  const wholeBoard = isWholeBoard(
    data.settlements.filter((row) => row.computed != null).map((row) => row.computed?.net ?? "0"),
  );

  return (
    <>
      <WhoOwesWhomBoard
        participants={lines}
        transfers={transfers}
        variant={lines.length > 1 ? "full" : "slice"}
        // Claimed only when the lines on screen really do sum to zero — see
        // `isWholeBoard`. A slice gets the note below instead.
        balanced={wholeBoard ? true : undefined}
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

      {data.commissions.map((commission) => (
        <Card
          key={commission.id}
          padding="lg"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <Eyebrow>Agent commission — private to you and your agent</Eyebrow>
          <KeyValueRow
            label={`${label(commission.performerParticipantId)} entitlement`}
            value={formatMoney(commission.performerEntitlement, currency)}
            mono
          />
          <KeyValueRow
            label={`Commission to ${label(commission.agentParticipantId)}`}
            value={formatMoney(commission.commission, currency)}
            mono
            total
          />
          <KeyValueRow
            label="Payout collected by"
            value={
              commission.agentCollects
                ? label(commission.agentParticipantId)
                : label(commission.performerParticipantId)
            }
          />
        </Card>
      ))}
    </>
  );
}
