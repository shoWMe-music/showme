import { Badge, Button, Card, Icon } from "@showme/design-system";
import { Link } from "@tanstack/react-router";
import { Eyebrow } from "./primitives";
import { settlementStatusToDisplay } from "./settlementDocument";
import { ErrorState, LoadingState } from "./states";
import { useEventSettlement } from "./useEventSettlement";

export interface EventSettlementTabProps {
  eventId: string;
  /** The event's base currency — every settled figure is denominated in it. */
  currency: string;
  /** The caller's own effective capabilities on this event. */
  capabilities: readonly string[];
}

/**
 * The event workspace's Settlement tab — deliberately THIN.
 *
 * It answers the one question the workspace is asking ("what did this night pay
 * me, and is it done?") and hands off. Everything else — the pool ladder, the rule
 * behind each figure, the approvals roster, the who-owes-whom board, finalizing —
 * lives in the full settlement workspace at `/events/:id/settlement`, because a
 * settlement is a document with its own sub-navigation and it was never going to
 * fit inside one tab of another screen.
 *
 * That split is the prototype's own: `shoWMe All View.dc.html:2551` is a mini tab
 * whose entire body is a headline figure, a status, and "Open full settlement
 * workspace". Nothing here computes; the figure is the hook's, already formatted.
 */
export function EventSettlementTab({ eventId, currency, capabilities }: EventSettlementTabProps) {
  const settlement = useEventSettlement(eventId, capabilities, currency);

  if (settlement.isPending) return <LoadingState label="Loading settlement" />;
  if (settlement.isError) {
    return <ErrorState error={settlement.error} title="Couldn't load the settlement" />;
  }

  const status = settlementStatusToDisplay(settlement.status);
  const headline = settlement.ownParty?.entitlement;

  return (
    <Card
      padding="lg"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        textAlign: "center",
      }}
    >
      <Eyebrow>Settlement</Eyebrow>
      <div style={{ fontSize: 44, fontWeight: 500, letterSpacing: "-0.03em" }}>
        {/* No entitlement yet is a real "not yet" — the event has not been
            reconciled — so it says so rather than printing a zero. */}
        {headline ?? "Not reconciled yet"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="muted">
          {settlement.ownParty ? "Your payout" : "You are not a party to this settlement"}
        </span>
        <Badge status={status.status} dot>
          {status.label}
        </Badge>
      </div>
      <Link to="/events/$eventId/settlement" params={{ eventId }}>
        <Button variant="primary" rightIcon={<Icon name="chevron-right" size={14} />}>
          Open full settlement workspace
        </Button>
      </Link>
    </Card>
  );
}
