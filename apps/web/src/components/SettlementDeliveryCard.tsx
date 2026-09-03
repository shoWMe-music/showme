import { Badge, Button, Card, Icon, Input } from "@showme/design-system";
import { useState } from "react";
import { formatDay } from "../lib/format";
import { CardTitle } from "./primitives";
import type { EventSettlement } from "./useEventSettlement";

/**
 * WHO HAS BEEN TOLD — the operator's side of sending a settlement out.
 *
 * Sending for review is two different jobs wearing one button, and this card is
 * where the difference becomes visible. A party WITH a shoWMe account is reached
 * by "Send for review" on its own: a notification in the app and a mail to the
 * address on their account, nothing to arrange. A party WITHOUT one cannot be
 * reached at all — nobody has recorded an address for them — so the operator says
 * where it goes, and the settlement travels the same way an event does through
 * Share & Export: a protected link, addressed to that mailbox, opened with a
 * one-time code.
 *
 * The scope on that link is fixed rather than chosen: their own line, and the
 * ability to sign it off. That is what "verify their end" needs and nothing more,
 * so there is no capability picker here — offering one would invite an operator
 * to send a settlement with the wrong half of the document attached.
 *
 * **It reports delivery, not intent.** "Sent" appears only once the mail sink
 * accepted the message, and the last-opened stamp is shown beside it, because the
 * question an operator actually has while waiting on a signature is not *did I
 * send this* but *did they read it*.
 *
 * Rendered only for a caller who can send — the API returns an empty `delivery`
 * to everyone else, so this is a list that cannot leak who is on the platform to
 * the acts on the bill.
 */
export function SettlementDeliveryCard({ settlement }: { settlement: EventSettlement }) {
  if (settlement.delivery.length === 0) return null;
  const offPlatform = settlement.delivery.filter((row) => !row.onPlatform);

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <CardTitle subtitle="Everyone on shoWMe is told when you send for review. Anyone else needs an address.">
          Sending it out
        </CardTitle>
        {offPlatform.length > 0 && <Badge status="pending">{offPlatform.length} to address</Badge>}
      </div>

      {settlement.delivery.map((row) => (
        <DeliveryRow
          key={row.participantId}
          row={row}
          isBusy={settlement.isInviting}
          onSend={(email) => settlement.sendInvitation(row.participantId, email, row.name)}
          onSendForReview={() => settlement.sendForReviewTo(row.participantId, row.name)}
        />
      ))}
    </Card>
  );
}

function DeliveryRow({
  row,
  isBusy,
  onSend,
  onSendForReview,
}: {
  row: EventSettlement["delivery"][number];
  isBusy: boolean;
  onSend: (email: string) => void;
  /** Ask THIS party to review, without waiting for the rest of the bill. */
  onSendForReview: () => void;
}) {
  // Pre-filled with whatever it was last sent to, so re-sending is one click and
  // correcting a typo does not mean retyping the address from memory.
  const [email, setEmail] = useState(row.invitedEmail ?? "");
  const canSend = email.trim().length > 0 && !isBusy;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        paddingTop: 10,
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ minWidth: 150, flex: "1 1 150px" }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{row.name}</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>{row.role}</div>
      </div>

      {row.onPlatform ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: "1 1 auto",
            flexWrap: "wrap",
          }}
        >
          <Badge status="confirmed" dot>
            On shoWMe
          </Badge>
          <span style={{ color: "var(--muted)", fontSize: 12, flex: "1 1 auto" }}>
            Reached in the app and by email when you send for review.
          </span>
          {/*
           * SEND TO THIS ONE PARTY — ClickUp `86cbcn1ue`: *"the option to send
           * settlement per collaborator or to all."*
           *
           * The model always allowed it: `status` lives on each participant's own
           * settlement row, so one party can be asked to review while another is
           * still being worked on. Only the route did not, and the button above
           * the card is still the "or to all" half.
           *
           * Worth having as its own action rather than a checkbox list: a promoter
           * who has agreed their half should not wait for the caterer's invoice to
           * arrive before being asked to sign, and that is a one-person decision
           * taken one person at a time.
           */}
          <Button
            variant="ghost"
            disabled={isBusy}
            leftIcon={<Icon name="mail" size={14} />}
            onClick={onSendForReview}
          >
            Send to {row.name}
          </Button>
        </div>
      ) : (
        <>
          <div style={{ flex: "2 1 220px" }}>
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="their@email.com"
              type="email"
              aria-label={`Email for ${row.name}`}
            />
          </div>
          <Button
            variant={row.invitedEmail ? "secondary" : "primary"}
            disabled={!canSend}
            leftIcon={<Icon name="mail" size={14} />}
            onClick={() => onSend(email.trim())}
          >
            {row.invitedEmail ? "Send again" : "Send settlement"}
          </Button>
          <div style={{ flexBasis: "100%", color: "var(--muted)", fontSize: 12 }}>
            {row.invitedAt ? (
              <>
                Sent {formatDay(row.invitedAt)}
                {/* Opened, not just delivered — the answer the operator wants. */}
                {row.lastSeenAt ? ` · opened ${formatDay(row.lastSeenAt)}` : " · not opened yet"}
              </>
            ) : (
              "Not on shoWMe — they get a private link and a one-time code, and can sign off from it."
            )}
          </div>
        </>
      )}
    </div>
  );
}
