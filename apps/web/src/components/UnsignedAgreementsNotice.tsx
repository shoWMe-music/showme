import { Button, Icon } from "@showme/design-system";
import { Link } from "@tanstack/react-router";

/**
 * WHY THE SETTLEMENT WILL NOT RUN, AND THE ONE CLICK THAT UNBLOCKS IT.
 *
 * A settlement cannot open while any agreement on the event is unsigned
 * (`docs/decisions.md` #21) — the API answers 409, so "Run the settlement",
 * "Finalize" and "Recalculate" are all disabled while this is showing. That rule
 * is the product owner's and is not in question here; what was wrong is what the
 * operator could DO about it.
 *
 * Reported again 2026-09-01 as *"Settlements is completely broken"*. Driving it
 * live showed the engine was fine — compute answers 200 on an event whose deal is
 * confirmed, and on an event with no deals at all — and that the whole of the
 * complaint was this dead end: the screen named the agreement it was waiting for
 * and then offered nothing, so the operator's next act ("go to the Deals tab and
 * send it") was something they had to already know. A refusal that names a cause
 * but no cure reads as a broken screen, and it was read as one.
 *
 * So the sentence keeps a door attached to it. The door is a LINK to the Deals
 * tab rather than a send button of its own: sending is `useEventAgreements`'
 * job and `DealAgreementCard` already draws "Send to parties" beside the terms
 * being sent. A second sender here would be a second thing to keep in step with
 * the agreement lifecycle, and the operator would be firing it at a deal whose
 * terms are off-screen.
 *
 * ONE PER SCREEN. The sentence used to be printed by three separate components,
 * and on the Financials tab two of them rendered together — the identical
 * paragraph twice, about 300px apart. This is the only thing that draws it now;
 * `SettlementActualsCard` takes a boolean and says nothing.
 */
export interface UnsignedAgreementsNoticeProps {
  /** The event whose Deals tab holds the agreements being waited on. */
  eventId: string;
  /**
   * The refusal, naming each outstanding agreement — `unsignedAgreementsNotice`
   * from `useEventSettlement`, which words it from the same three conditions the
   * server's `assertEveryAgreementSigned` asks in the same order.
   */
  notice: string;
}

export function UnsignedAgreementsNotice({ eventId, notice }: UnsignedAgreementsNoticeProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        flexWrap: "wrap",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-2, var(--surface))",
      }}
    >
      <Icon name="alert" size={15} />
      <p style={{ margin: 0, flex: "1 1 260px", fontSize: 12.5, lineHeight: 1.55 }}>{notice}</p>
      {/* The act itself, not a description of it. `?tab=deals` is the one place an
          agreement is sent from, so this lands the operator on the card that
          carries the terms AND the button. */}
      <Link to="/events/$eventId" params={{ eventId }} search={{ tab: "deals" }}>
        <Button variant="secondary" rightIcon={<Icon name="chevron-right" size={14} />}>
          Go to the agreements
        </Button>
      </Link>
    </div>
  );
}
