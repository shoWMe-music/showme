import { Badge, Button, Card, Icon } from "@showme/design-system";
import { Link } from "@tanstack/react-router";
import { PRO_FILING_AVAILABLE } from "../lib/proFilingAvailability";
import { SettlementPartyCard } from "./SettlementPartyCard";
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
 * The event workspace's Settlement tab: what this night pays, to whom, and why.
 *
 * It shows a card per PARTY, carrying the rule behind each figure — the same card
 * the full workspace draws, from the same component, so the two can never disagree
 * about what somebody is owed.
 *
 * What it deliberately does NOT carry is everything that makes a settlement a
 * document rather than a summary: the pool ladder, the who-owes-whom board,
 * finalizing, the approvals roster, the review conversation. Those live at
 * `/events/:id/settlement`, and the button at the foot goes there. That split is
 * the prototype's own (`shoWMe All View.dc.html:2551`).
 *
 * A party sees only their own card, and that is the API's doing rather than this
 * screen's — the settlement payload is already party-scoped, so a performer's tab
 * is short by the lines that were never theirs to read (`story.md:44`).
 */
export function EventSettlementTab({ eventId, currency, capabilities }: EventSettlementTabProps) {
  const settlement = useEventSettlement(eventId, capabilities, currency);

  if (settlement.isPending) return <LoadingState label="Loading settlement" />;
  if (settlement.isError) {
    return <ErrorState error={settlement.error} title="Couldn't load the settlement" />;
  }

  const status = settlementStatusToDisplay(settlement.status);
  const headline = settlement.ownParty?.entitlement;
  // The PRO filing is the operator's, and the ceiling refuses the capability to
  // everyone else (`OPERATOR_FILING_CAPABILITIES`). Asking for it here means the
  // link appears only for someone who could actually file — a pointer to a screen
  // that would turn them away is worse than no pointer.
  //
  // It is moot while `PRO_FILING_AVAILABLE` is false: nobody can file yet, so the
  // button is not drawn at all. A disabled "coming soon" chip would be worse here
  // than absence — this tab is about `Σ net = 0` between the parties on the bill,
  // and a society's royalties are a different money stream that never enters it.
  const canFile = capabilities.includes("performance_report.file");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
          {/* "No settlement rows" and "no settlement row FOR YOU" are different
              facts, and this line used to conflate them: `ownParty` is null for
              everyone — the operator included — until somebody runs the reconcile,
              so an unreconciled event told its own operator they had no stake in
              it. The payload is already party-scoped, so an empty `parties` can
              only mean nothing has been computed yet. */}
          <span className="muted">
            {settlement.ownParty
              ? "Your payout"
              : settlement.parties.length === 0
                ? "This event hasn't been reconciled yet"
                : "You are not a party to this settlement"}
          </span>
          <Badge status={status.status} dot>
            {status.label}
          </Badge>
        </div>
      </Card>

      {settlement.parties.map((party) => (
        <SettlementPartyCard key={party.settlementId} party={party} />
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link to="/events/$eventId/settlement" params={{ eventId }}>
          <Button variant="primary" rightIcon={<Icon name="chevron-right" size={14} />}>
            Open full settlement workspace
          </Button>
        </Link>
        {/*
         * A POINTER, not a panel. The PRO filing is a different money stream
         * entirely — a collecting society paying rightsholders, on its own
         * schedule, to people who may not be on this bill — and it never enters
         * the settlement's `Σ net = 0`. It has its own screen (`/reports`,
         * decisions.md #627). This link exists only because the operator thinks
         * about filing while looking at the show, and it must never become a
         * place where PRO content lives.
         */}
        {PRO_FILING_AVAILABLE && canFile && (
          <Link to="/reports">
            <Button variant="secondary" leftIcon={<Icon name="trending-up" size={14} />}>
              Report to PRO
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
