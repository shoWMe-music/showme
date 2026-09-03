import { Badge, Button, Card, Icon, KeyValueRow } from "@showme/design-system";
import { useEffect } from "react";
import { formatStartTime } from "../components/CalendarEventChip";
import { ShareOtpGate } from "../components/ShareOtpGate";
import { type ShareComment, ShareSectionCard } from "../components/ShareSectionCard";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { type ShareDocument, useShareViewer } from "../hooks/useShareViewer";
import { formatDay, formatMoney } from "../lib/format";

/**
 * ONE viewer, for everyone.
 *
 * Not a page per audience — the sections that appear are the sections the
 * SERIALIZER granted, so a venue's accountant, a support act and a booking agent
 * all land here and each sees a different document without this file knowing
 * anything about who they are. The agent's own settlement view lives here too, for
 * the reason the owner gave: it is "in the same view as everyone else's."
 *
 * It is chrome-less on purpose — no sidebar, no nav, no account. This is the
 * document, the one act it asks for, and the thread beside it. Everything is a
 * LIVE read of current state: revoke the link and the next load is a 404, change a
 * figure and the next load says so. Nothing here is a snapshot.
 *
 * WHAT IT LOOKS LIKE comes from this design system, not from the old app. The old
 * `SharedEventPage` / `SettlementReviewPage` were read for their SHAPE — a document
 * first, one primary act under it, the conversation beside it, and the reviewer's
 * name in the corner — and for nothing else. The surface itself is composed the way
 * `AgreementView` already composes a document in this app: stacked `Card`s, an
 * `Eyebrow` per section, a `KeyValueRow` grid for the facts, money in mono and
 * rounded (`docs/design-handoff-budget-planner.md` §5), every colour a shell token.
 * Being a page with no sibling makes it the easiest place to start a second visual
 * language by accident; the answer is to keep borrowing from the sibling it does
 * have.
 */
export function ShareViewer({ token }: { token: string }) {
  const share = useShareViewer(token);

  /**
   * LIGHT, unconditionally — the same choice the invitation landing page made.
   *
   * This page is rendered BEFORE the auth gate and outside `AppShell`
   * (`main.tsx`), and `AppShell` is the only thing in the app that stamps
   * `data-theme="light"` on `<html>`. The token file's own default is dark, so
   * every share link opened in a palette the product does not otherwise use.
   *
   * Not `prefers-color-scheme`, and the reason is not laziness. That setting is a
   * statement about the reader's whole desktop, not about this product, and
   * honouring it here would hand a dark-desktop recipient a theme no screen in
   * this app has ever been reviewed in — STYLE-GUIDE.md is written entirely about
   * light — on the one page with no toggle to escape it. A recipient is an
   * outsider who clicked a link in an email: what they see is the product's face,
   * and it should be the face the product was designed as. If dark ever becomes a
   * supported recipient experience it arrives with a reviewed palette and a
   * control, on this page and the invitation page together.
   *
   * Removed on unmount so this page cannot decide the theme for anything else.
   */
  useEffect(() => {
    const element = window.document.documentElement;
    element.setAttribute("data-theme", "light");
    return () => element.removeAttribute("data-theme");
  }, []);

  return (
    <div style={pageStyle}>
      <div
        style={{ width: "100%", maxWidth: 780, display: "flex", flexDirection: "column", gap: 16 }}
      >
        {share.needsVerification ? (
          <ShareOtpGate
            email={share.email}
            onEmailChange={share.setEmail}
            code={share.code}
            onCodeChange={share.setCode}
            codeSent={share.codeSent}
            onSendCode={share.sendCode}
            onVerify={share.verify}
            isSendingCode={share.isSendingCode}
            isVerifying={share.isVerifying}
          />
        ) : share.isPending ? (
          <LoadingState label="Opening" />
        ) : share.isError ? (
          <ErrorState error={share.error} title="This link is no longer live" />
        ) : share.document ? (
          <ShareDocumentBody document={share.document} share={share} />
        ) : null}
      </div>
    </div>
  );
}

type ShareViewerState = ReturnType<typeof useShareViewer>;

function ShareDocumentBody({
  document,
  share,
}: {
  document: ShareDocument;
  share: ShareViewerState;
}) {
  const currency = document.event?.baseCurrency ?? "EUR";
  const comments = (document.comments ?? []) as ShareComment[];
  const canComment = document.actions.canComment;
  const sectionProps = (section: string, title: string, commentSubject: string) => ({
    section,
    title,
    commentSubject,
    comments,
    canComment,
    isCommenting: share.isCommenting,
    onComment: (message: string) => share.comment({ message, section }),
  });

  return (
    <>
      <ShareHeader document={document} />

      {document.event && (
        <ShareSectionCard {...sectionProps("event", "The show", "the show")}>
          <div style={fieldGridStyle}>
            <KeyValueRow label="Event" value={document.event.title} />
            <KeyValueRow label="Date" value={formatDay(document.event.eventDate)} />
            <KeyValueRow label="Venue" value={document.event.venueName ?? "—"} />
            <KeyValueRow
              label="Doors"
              value={formatStartTime(document.event.doorTime ?? undefined) ?? "—"}
            />
            <KeyValueRow
              label="On stage"
              value={formatStartTime(document.event.startTime ?? undefined) ?? "—"}
            />
            <KeyValueRow
              label="Capacity"
              value={document.event.capacity == null ? "—" : String(document.event.capacity)}
              mono
            />
          </div>
          {document.event.notes && (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              {document.event.notes}
            </p>
          )}
        </ShareSectionCard>
      )}

      {document.schedule && (
        <ShareSectionCard {...sectionProps("schedule", "Schedule", "the schedule")}>
          {document.schedule.length === 0 ? (
            <Empty>Nothing scheduled yet.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {document.schedule.map((item) => (
                <div key={item.id} style={scheduleRowStyle}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      color: "var(--muted)",
                    }}
                  >
                    {item.localDateTime ? item.localDateTime.replace("T", " · ") : "—"}
                  </span>
                  <span style={{ color: "var(--text)", fontSize: 13.5 }}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </ShareSectionCard>
      )}

      {document.riders && (
        <ShareSectionCard {...sectionProps("riders", "Riders & documents", "the documents")}>
          {document.riders.length === 0 ? (
            <Empty>No documents attached.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {document.riders.map((rider) => (
                <div key={rider.id} style={rowStyle}>
                  <span style={{ color: "var(--text)", fontSize: 13.5 }}>{rider.name}</span>
                  <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{rider.type}</span>
                </div>
              ))}
            </div>
          )}
        </ShareSectionCard>
      )}

      {document.budget && (
        <ShareSectionCard {...sectionProps("budget", "Budget", "the budget")}>
          <div style={fieldGridStyle}>
            <KeyValueRow
              label="Revenue"
              value={formatMoney(document.budget.revenueTotal, document.budget.currency)}
              mono
            />
            <KeyValueRow
              label="Costs"
              value={formatMoney(document.budget.costTotal, document.budget.currency)}
              mono
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {document.budget.lines.map((line) => (
              <div key={line.id} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13.5 }}>{line.label}</span>
                <span
                  style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--muted)" }}
                >
                  {formatMoney(line.amount, line.currency ?? document.budget?.currency ?? currency)}
                </span>
              </div>
            ))}
          </div>
        </ShareSectionCard>
      )}

      {document.deals?.map((deal) => (
        <ShareSectionCard
          key={deal.id}
          {...sectionProps("deal", "Your agreement", "your agreement")}
          action={
            document.actions.canConfirmAgreement &&
            // A draft is not signable — `POST /shares/:token/approve` answers 409
            // on one, the same as the in-app door. Mirrored here so the button is
            // offered to exactly the callers the route will accept, which is the
            // rule `dealActionsFor` already follows inside the app.
            deal.agreementStatus !== "draft" &&
            !deal.parties.some((party) => party.confirmedAt) ? (
              <Button
                variant="cta"
                onClick={() => share.approve({ subject: "agreement", dealId: deal.id })}
                disabled={share.isApproving}
              >
                Confirm your line
              </Button>
            ) : undefined
          }
        >
          <div style={fieldGridStyle}>
            <KeyValueRow label="Deal" value={deal.name} />
            <KeyValueRow label="Type" value={deal.type.replace(/_/g, " ")} />
            <KeyValueRow label="Status" value={deal.agreementStatus.replace(/_/g, " ")} />
            {deal.guaranteeAmount && (
              <KeyValueRow
                label="Guarantee"
                value={formatMoney(deal.guaranteeAmount, deal.currency ?? currency)}
                mono
              />
            )}
          </div>
          {/* Only the recipient's own line reaches the client at all — the
              serializer filtered the rest away server-side, so there is nothing
              here to hide and nothing to leak. */}
          {deal.parties.map((party) => (
            <div key={party.id} style={rowStyle}>
              <span style={{ color: "var(--text)", fontSize: 13.5 }}>
                Your line · {party.roleInDeal.replace(/_/g, " ")}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                {party.confirmedAt ? `Confirmed ${formatDay(party.confirmedAt)}` : "Not confirmed"}
              </span>
            </div>
          ))}
          {deal.agreementBodyText && (
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontSize: 13,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
              }}
            >
              {deal.agreementBodyText}
            </p>
          )}
        </ShareSectionCard>
      ))}

      {document.settlement && (
        <ShareSectionCard
          {...sectionProps("settlement", "Your settlement", "your settlement")}
          action={
            document.actions.canConfirmSettlement && !document.settlement.approvedAt ? (
              <Button
                variant="cta"
                onClick={() => share.approve({ subject: "settlement" })}
                disabled={share.isApproving}
              >
                Approve settlement
              </Button>
            ) : document.settlement.approvedAt ? (
              <Badge status="confirmed" dot>
                Approved {formatDay(document.settlement.approvedAt)}
              </Badge>
            ) : undefined
          }
        >
          <div style={fieldGridStyle}>
            <KeyValueRow
              label="Entitlement"
              value={formatMoney(document.settlement.entitlement, document.settlement.currency)}
              mono
            />
            <KeyValueRow
              label="Held by you"
              value={formatMoney(document.settlement.held, document.settlement.currency)}
              mono
            />
            {/* NAMED, not folded into "Held by you".
                `held = collected − paid + prepaid`, so an advance is already
                inside the figure above — which is precisely why it has to be said
                out loud. A performer opening this saw "Held by you 10 000" and no
                hint that the 10 000 was the guarantee they were paid in March.
                Shown only when something actually moved early. */}
            {document.settlement.prepaid && (
              <KeyValueRow
                label={
                  document.settlement.prepaidWith
                    ? `Paid in advance, with ${document.settlement.prepaidWith}`
                    : "Paid in advance"
                }
                value={formatMoney(document.settlement.prepaid, document.settlement.currency)}
                mono
              />
            )}
            <KeyValueRow
              label="Net"
              value={formatMoney(document.settlement.net, document.settlement.currency)}
              mono
            />
            <KeyValueRow label="Status" value={document.settlement.status.replace(/_/g, " ")} />
          </div>
          {document.settlement.transfers.map((transfer) => (
            <div key={transfer.id} style={rowStyle}>
              <span style={{ color: "var(--text)", fontSize: 13.5 }}>
                {transfer.direction === "incoming" ? "You are owed" : "You owe"}
              </span>
              <span
                style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--muted)" }}
              >
                {formatMoney(
                  transfer.amount,
                  transfer.currency ?? document.settlement?.currency ?? currency,
                )}
                {" · "}
                {transfer.state}
              </span>
            </div>
          ))}
        </ShareSectionCard>
      )}

      <ShareFooter document={document} />
    </>
  );
}

function ShareHeader({ document }: { document: ShareDocument }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Eyebrow>Shared with you{document.sharedBy ? ` by ${document.sharedBy}` : ""}</Eyebrow>
      <h1
        style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 26, color: "var(--text)" }}
      >
        {document.event?.title ?? "Shared document"}
      </h1>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>
        {document.viewer.isParty
          ? `Reviewing as ${document.viewer.partyName ?? document.viewer.email}`
          : `Viewing as ${document.viewer.name ?? document.viewer.email ?? "a guest"}`}
      </span>
    </div>
  );
}

/**
 * The footer says two true things and promises nothing.
 *
 * "Live" is the honest opposite of the old app's banner ("Snapshot — does not
 * update automatically. Ask Daniel for a fresh link."), and the claim prompt is
 * the record, not a flow: when the recipient's address already has a shoWMe
 * account we say so, because that account is how they would get this without a
 * link at all.
 *
 * It USED to say "create a shoWMe account with that address and this show follows
 * you in", and that is not what happens. `share_recipients.claimed_by_user_id` is
 * stamped when a signed-in account with that verified email opens the link — a
 * record, and nothing walks it at signup, so no show follows anyone anywhere. A
 * page whose whole footer is about being trustworthy cannot end on a promise the
 * product does not keep; what is written now is what the account actually buys
 * you, which is being addable to a show without a link at all.
 */
function ShareFooter({ document }: { document: ShareDocument }) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="eye" size={15} />
        <span style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.6 }}>
          This page reads the event as it stands right now — it is not a copy, and whoever shared it
          can switch it off at any time.
          {document.expiresAt ? ` It stops working on ${formatDay(document.expiresAt)}.` : ""}
        </span>
      </div>
      {document.viewer.email && (
        <span style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.6 }}>
          {document.viewer.claimed
            ? `${document.viewer.email} already has a shoWMe account — sign in and anything you have been added to is on your dashboard.`
            : `Shared with ${document.viewer.email}. With a shoWMe account on that address, the people you work with can add you to a show directly instead of sending a link.`}
        </span>
      )}
    </Card>
  );
}

function Empty({ children }: { children: string }) {
  return <span style={{ color: "var(--muted)", fontSize: 13 }}>{children}</span>;
}

const pageStyle = {
  minHeight: "100dvh",
  background: "var(--bg)",
  display: "flex",
  justifyContent: "center",
  padding: "48px 20px 80px",
} as const;

const fieldGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "2px 24px",
} as const;

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "baseline",
} as const;

/**
 * The run of show is the one list here that is NOT a label-and-its-value.
 * `rowStyle`'s `space-between` pushed every set time to one edge and its label to
 * the other, so the eye had to cross the card to read "15:00 — Load-in". A
 * schedule line is one sentence: the time, then what happens at it.
 */
const scheduleRowStyle = {
  display: "flex",
  gap: 12,
  alignItems: "baseline",
} as const;
