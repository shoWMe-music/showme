import { Badge, Button, Icon, Select, Toggle } from "@showme/design-system";
import { type EventHoldView, useEventHold } from "../hooks/useEventHold";
import { ConfirmDialog, useConfirmDialog } from "./ConfirmDialog";
import { HoldRankBadge, holdOrdinal } from "./HoldPlacement";
import { CardHeader, Eyebrow, SectionCard } from "./eventUi";

export interface EventHoldPanelProps {
  eventId: string;
}

/**
 * The holds panel — the queue for a date, and what this caller may do about it.
 *
 * A HOLD IS A DATE THE OPERATOR IS KEEPING WARM. Until now the app wrote a rank
 * once in the create wizard, showed it in one toast, and never mentioned it
 * again: the event screen said "On hold" and stopped, so an operator running
 * three pencils on a Saturday had no way to see the order they were in, change
 * it, or give one up — and the act on the other end had no way to say yes,
 * although `POST /hold/confirm` had been sitting there the whole time, called by
 * nothing.
 *
 * TWO AUDIENCES, ONE PANEL, DIFFERENT SENTENCES. The operator's view is the
 * queue: who is in it, in what order, which pencils move up on their own, and
 * the four acts that change it (reorder, promote, freeze, release). The act's
 * view is a single question — take the date or turn it down — with **no ranks at
 * all**: where an act sits in an operator's queue is the operator's private
 * competitive information (`serialize/event.ts`), and the API withholds it, so
 * there is nothing here to leak even if this component asked.
 *
 * WHICH SENTENCE YOU GET IS DECIDED BY THE SERVER. `canManageRank` and
 * `canDecide` come off `GET /events/:id/hold`, computed by the same code the
 * write routes enforce with — see {@link useEventHold} for why `canDecide` in
 * particular cannot be read off `capabilities[]`.
 */
export function EventHoldPanel({ eventId }: EventHoldPanelProps) {
  const hold = useEventHold(eventId);
  const confirmation = useConfirmDialog();

  // Not a hold (or not loaded, or a caller with no say in either direction) —
  // the panel has nothing to say, so it says nothing rather than an empty card.
  if (hold.isLoading || !hold.isHold) return null;
  if (!hold.canManageRank && !hold.canDecide) return null;

  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="clock" size={16} />}
        iconColor="var(--brand-amber)"
        title="Hold"
        action={<HoldRankBadge holdRank={hold.holdRank} />}
      />
      {hold.canManageRank && <HoldQueue hold={hold} />}
      {hold.canManageRank && <OperatorControls hold={hold} confirmation={confirmation} />}
      {hold.canDecide && <ActControls hold={hold} confirmation={confirmation} />}
      <ConfirmDialog {...confirmation.dialogProps} />
    </SectionCard>
  );
}

/** The queue for the date, in rank order, with this event called out. */
function HoldQueue({ hold }: { hold: EventHoldView }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Eyebrow>
        {hold.pool.length === 1
          ? "Nothing else is competing for this date"
          : `${hold.pool.length} holds on this date`}
      </Eyebrow>
      {hold.pool.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: entry.isSelf
              ? "color-mix(in srgb,var(--brand-amber) 10%,transparent)"
              : "var(--surface)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--muted)",
              minWidth: 30,
            }}
          >
            {holdOrdinal(entry.holdRank)}
          </span>
          <span style={{ flex: 1, fontSize: 13.5, color: "var(--text)" }}>
            {/* A pool is matched by (date, venue, stage) and is NOT scoped to one
                host, so a competing pencil can belong to an operator this caller
                has no standing with. The API sends no title for those, and the
                honest thing to draw is that a rank is taken — not a guess at
                whose. */}
            {entry.title ?? "A hold from another operator"}
          </span>
          {entry.isSelf && <Badge status="pending">This event</Badge>}
          {!entry.holdAutoPromote && <Badge>Frozen</Badge>}
        </div>
      ))}
    </div>
  );
}

/** Reorder / promote / freeze / release — everything behind `event.edit`. */
function OperatorControls({
  hold,
  confirmation,
}: {
  hold: EventHoldView;
  confirmation: ReturnType<typeof useConfirmDialog>;
}) {
  const askToRelease = () =>
    confirmation.ask({
      title: "Release this hold?",
      body: "The date stops being held for this event and the event is cancelled. Every hold below it moves up one — unless it is frozen. This cannot be undone from here.",
      confirmLabel: "Release hold",
      destructive: true,
      onConfirm: hold.release,
    });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        marginTop: 16,
        paddingTop: 16,
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {hold.rankOptions.length > 1 && (
          <Select
            value={String(hold.holdRank ?? 1)}
            onChange={(value) => hold.setRank(Number(value))}
            aria-label="Hold priority"
            disabled={hold.isWorking}
            options={hold.rankOptions.map((rank) => ({
              value: String(rank),
              label: `${holdOrdinal(rank)} hold`,
            }))}
          />
        )}
        <Button
          variant="secondary"
          onClick={hold.promoteToFirst}
          disabled={hold.isWorking || !hold.canPromoteToFirst}
        >
          Promote to 1st
        </Button>
        <Button variant="ghost" onClick={askToRelease} disabled={hold.isWorking}>
          Release hold
        </Button>
      </div>

      {/* A div, not a <label>: the design-system `Toggle` is a `role="switch"`
          button rather than an input, so it labels itself via `label` and a
          wrapping <label> would only add a second, silent click target. Same
          shape the profile-visibility and VAT toggles use. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Toggle
          checked={hold.holdAutoPromote}
          onChange={hold.setAutoPromote}
          disabled={hold.isWorking}
          label="Move up automatically"
        />
        <span style={{ fontSize: 13, color: "var(--text)" }}>
          Move up automatically
          <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>
            {hold.holdAutoPromote
              ? "When a hold above this one is released or turned down, this one takes its place."
              : "This hold keeps its number even when the holds above it go away."}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * The act's half: take the date, or turn it down.
 *
 * NO RANK IS SHOWN OR ASKED FOR — the API sends none to a caller without
 * `event.edit`, and the wording deliberately never implies a queue exists.
 */
function ActControls({
  hold,
  confirmation,
}: {
  hold: EventHoldView;
  confirmation: ReturnType<typeof useConfirmDialog>;
}) {
  const askToConfirm = () =>
    confirmation.ask({
      title: "Confirm this date?",
      body: "The event moves to Confirmed and the date is yours. Any other hold the operator is running on this date is cancelled.",
      confirmLabel: "Confirm date",
      onConfirm: hold.confirmDate,
    });

  const askToDecline = () =>
    confirmation.ask({
      title: "Turn this date down?",
      body: "The event is cancelled and the operator is free to give the date to someone else. This cannot be undone from here.",
      confirmLabel: "Turn it down",
      destructive: true,
      onConfirm: hold.declineDate,
    });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginTop: 16,
        paddingTop: 16,
        borderTop: "1px solid var(--border)",
      }}
    >
      <Button onClick={askToConfirm} disabled={hold.isWorking}>
        Confirm date
      </Button>
      <Button variant="ghost" onClick={askToDecline} disabled={hold.isWorking}>
        Turn it down
      </Button>
    </div>
  );
}
