import { Button, Icon, Modal, Select, Toggle } from "@showme/design-system";
import { useState } from "react";
import { Eyebrow } from "./primitives";
import type { EventSettlement } from "./useEventSettlement";

/**
 * SEND SETTLEMENT FOR REVIEW — Ran's modal, from the two screenshots he attached
 * (`claude-prototype/ran-2026-09-10/send-for-review-1.png`, `-2.png`).
 *
 * Three decisions in one dialog: everyone or one party, which party, and whether
 * they may see the whole thing.
 *
 * **The "Full settlement access" toggle is a reversal, not a convenience.**
 * `story.md:44` said a performer never sees the pool "even if an operator wanted
 * to show them"; the owner's decision on 2026-09-15 (decisions.md #24.2) is that
 * they may. The switch is drawn OFF every time the dialog opens even when a
 * standing grant exists, because it is a statement about THIS send: leaving it on
 * because somebody was granted access last month would make an operator re-grant
 * by not noticing.
 *
 * Dumb: it collects three values and hands them to `settlement.sendForReview`.
 * What a grant means, and where it stops, is the API's.
 */
export function SendForReviewDialog({
  settlement,
  onClose,
}: { settlement: EventSettlement; onClose: () => void }) {
  const [mode, setMode] = useState<"all" | "one">("all");
  /*
   * OTHER PEOPLE FIRST. `delivery` includes the operator's own row — a
   * co-operator reviewing is a real thing — but defaulting the recipient to
   * YOURSELF makes the commonest use of this dialog (send it to the act) a
   * two-step, and the commonest mistake (send it to nobody) a one-step.
   */
  /*
   * …AND NEVER THE READER THEMSELVES (QA sweep run 6, QA6-15).
   *
   * The sort above put the reader's own row last rather than removing it, so the
   * chooser offered `The Lantern Hall (Operator)` to the operator sending their own
   * settlement out — an offer to send it to yourself for review.
   *
   * Only the READER is dropped, not "the operator": the comment above is right that a
   * co-operator reviewing is a real thing, and on the host's screen the co-host's row
   * belongs here. An event whose only party is the reader therefore has nobody to send
   * to, and the dialog says so rather than showing an empty picker.
   */
  const recipients = settlement.delivery.filter(
    (row) => row.participantId !== settlement.ownParty?.participantId,
  );
  const [recipientId, setRecipientId] = useState<string>(recipients[0]?.participantId ?? "");
  const chosen = recipients.find((row) => row.participantId === recipientId) ?? null;

  /*
   * THE TOGGLE STARTS WHERE THE GRANT ALREADY IS, and a re-send that nobody
   * touched changes nobody's access.
   *
   * It used to be `useState(false)`, never seeded from the stored grant. So the
   * dialog reopened OFF for a party who had full access and sent an explicit
   * `fullAccess: false` — a reminder silently revoked the disclosure, taking that
   * party's settlement from six rows back to one. Measured 2026-09-26 against
   * decisions.md #24.2, whose last clause is exactly "re-sending without touching
   * the toggle does not silently revoke it".
   *
   * Two halves, because either alone still lies. The toggle SHOWS the stored grant
   * (per recipient in "one" mode — `chosen` keys the initial value). And the field
   * is sent only once the operator has actually moved it: the API leaves the grant
   * alone when it is absent, so an untouched dialog cannot revoke anything, and in
   * "all" mode — one switch over parties who may each have a different answer — it
   * never overwrites what it was not asked to.
   */
  const storedGrant = mode === "one" ? chosen?.fullAccess === true : false;
  const [grantTouched, setGrantTouched] = useState(false);
  const [grantChoice, setGrantChoice] = useState(false);
  const fullAccess = grantTouched ? grantChoice : storedGrant;
  const setFullAccess = (next: boolean) => {
    setGrantTouched(true);
    setGrantChoice(next);
  };
  const canSend = mode === "all" ? recipients.length > 0 : chosen != null;

  const send = () => {
    settlement.sendForReview({
      ...(mode === "one" && chosen ? { participantIds: [chosen.participantId] } : {}),
      ...(grantTouched ? { fullAccess: grantChoice } : {}),
    });
    onClose();
  };

  return (
    // The design system's Modal, not a hand-rolled overlay. The first attempt was
    // a `position: fixed` scrim of its own and it rendered INSIDE the page column
    // rather than over the viewport — an ancestor of the settlement page
    // establishes a containing block, so "fixed" was fixed to it. `Modal` portals
    // to `document.body` and has no such problem, which is the whole argument for
    // not rebuilding what the system already has.
    <Modal
      open
      onClose={onClose}
      title="Send settlement for review"
      width={520}
      // It holds a choice the operator has made — the mode, the recipient, and a
      // disclosure decision. A click a millimetre outside must not discard that.
      dismissOnScrim={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSend || settlement.isBusy}
            leftIcon={<Icon name="mail" size={14} />}
            onClick={send}
          >
            Send for review
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
          Collaborators see only their own settlement details unless you grant full access.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Button
            variant={mode === "all" ? "primary" : "secondary"}
            onClick={() => {
              setMode("all");
              setGrantTouched(false);
            }}
          >
            All collaborators
          </Button>
          <Button
            variant={mode === "one" ? "primary" : "secondary"}
            onClick={() => {
              setMode("one");
              setGrantTouched(false);
            }}
          >
            One by one
          </Button>
        </div>

        {recipients.length === 0 && (
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            There is nobody else on this settlement to send it to yet. Add a collaborator to the
            event first.
          </p>
        )}

        {mode === "one" && recipients.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Eyebrow>Recipient</Eyebrow>
            <Select
              value={recipientId}
              onChange={(next) => {
                setRecipientId(next);
                // Another party, another stored answer — a choice made about the
                // last one must not follow the operator onto this one.
                setGrantTouched(false);
              }}
              options={recipients.map((row) => ({
                value: row.participantId,
                label: `${row.name} (${row.role})`,
              }))}
            />
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid var(--border)",
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>Full settlement access</div>
            <span className="muted" style={{ fontSize: 12.5 }}>
              Let {mode === "one" && chosen ? chosen.name : "recipients"} see all parties' financial
              details and the event's totals.
            </span>
          </div>
          <Toggle
            checked={fullAccess}
            onChange={setFullAccess}
            label="Grant full settlement access"
          />
        </div>

        {/* WHAT THE OPERATOR IS ABOUT TO DO, in a sentence, because it is a
            disclosure they cannot un-make quietly — it is recorded, and the party
            will have seen it. */}
        {fullAccess && (
          <span
            className="muted"
            style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12.5 }}
          >
            <Icon name="eye" size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            They will see the whole night — every party's figures and what the event took. You can
            withdraw it later, and the grant is recorded either way.
          </span>
        )}
      </div>
    </Modal>
  );
}
