import { Button, Modal, TextField } from "@showme/design-system";
import type { ReactNode } from "react";
import { formatDate } from "../lib/format";
import { DatePickerField } from "./DatePickerField";
import { Eyebrow } from "./primitives";
import type { RequestTriage, RequestTriageAction } from "./useRequestTriage";

/**
 * The confirmations and composers behind the Incoming Requests action bar.
 *
 * Dumb by design — every decision lives in `useRequestTriage`. What it is careful
 * about is TELLING THE TRUTH before each action, because three of the five reach
 * somebody else:
 *
 * - **Decline** notifies an on-platform sender. A public-form sender has no
 *   account to notify, so the dialog says the reply has to be an email.
 * - **Block** accuses a person of spam and cannot be withdrawn from this app.
 * - **Create Draft** does not spend a free-plan event slot; confirming the event
 *   later does. The dialog names that instead of letting it be discovered as a
 *   403 weeks afterwards.
 */
export interface RequestTriageDialogsProps {
  triage: RequestTriage;
  /** Leave for the draft event this flow just created. */
  onOpenEvents: () => void;
}

const TITLES: Record<RequestTriageAction, string> = {
  draft: "Create draft event",
  offer: "Make an offer",
  decline: "Decline this request",
  block: "Block this sender",
  archive: "Archive this request",
  restore: "Restore this request",
};

export function RequestTriageDialogs({ triage, onOpenEvents }: RequestTriageDialogsProps) {
  const { action, request } = triage;
  if (!action || !request) return null;

  const requester = request.artistName ?? request.contactName ?? "this sender";
  const hasAccount = request.senderProfileId != null;
  /**
   * WHO a spam report actually accuses: the profile that SENT the request. On an
   * agent's offer that is the AGENCY, not the act being offered — the report lands
   * on `sender_profile_id`, and naming the performer here would ask the operator
   * to accuse the wrong party (story.md: an agent acts THROUGH the performer; the
   * performer does not answer for the agency's conduct).
   */
  const accused = request.onBehalfOfProfileId
    ? (request.contactName ?? "the agency that sent this")
    : requester;
  const draft = triage.draftResult;
  const counter = triage.counterResult;
  const done = draft != null || counter != null;

  return (
    <Modal
      open
      onClose={triage.close}
      title={done ? "Done" : TITLES[action]}
      width={action === "offer" || action === "draft" ? 520 : 440}
      footer={
        done ? (
          <>
            {draft && (
              <Button variant="ghost" onClick={onOpenEvents}>
                Go to Events
              </Button>
            )}
            <Button variant="primary" onClick={triage.close}>
              Close
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={triage.close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={triage.confirm}
              disabled={
                triage.pending || (action === "offer" && triage.message.trim().length === 0)
              }
            >
              {triage.pending ? "Working…" : confirmLabel(action)}
            </Button>
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {draft ? (
          <>
            <Paragraph>
              <Strong>{draft.title}</Strong> is now a draft event
              {draft.eventDate ? ` on ${formatDate(draft.eventDate)}` : ""}, in {draft.baseCurrency}
              . The request stays in your inbox as pending — starting the work is not an answer to{" "}
              {requester}.
            </Paragraph>
            <Callout tone={draft.eventCap.allowed ? "neutral" : "danger"}>
              <Strong>Drafts are free.</Strong>{" "}
              {draft.eventCap.limit == null
                ? "Your plan has no event limit."
                : draft.eventCap.allowed
                  ? `Your plan allows ${draft.eventCap.limit} confirmed events and you have used ${draft.eventCap.used ?? 0}. Confirming this one later is what spends a slot — a draft costs nothing.`
                  : // The cap is already full: saying "confirming spends a slot"
                    // would be a half-truth, because there is no slot to spend.
                    `Your plan allows ${draft.eventCap.limit} confirmed events and all ${draft.eventCap.used ?? 0} are used. The draft is saved, but confirming it will be refused until you upgrade or a confirmed event is freed.`}
            </Callout>
          </>
        ) : counter ? (
          <Paragraph>
            {counter.delivered ? (
              counter.channel === "email" ? (
                <>
                  Your terms were emailed to <Strong>{counter.deliveredTo}</Strong>, with your
                  address as the reply-to. The request stays pending until they answer.
                </>
              ) : (
                <>
                  Your terms are in <Strong>{requester}</Strong>'s inbox. The request stays pending
                  until they answer.
                </>
              )
            ) : (
              <>
                The terms are recorded, but we could not deliver them to {requester}. Reach them
                directly{request.email ? ` at ${request.email}` : ""}.
              </>
            )}
          </Paragraph>
        ) : (
          <ActionBody
            action={action}
            triage={triage}
            requester={requester}
            accused={accused}
            hasAccount={hasAccount}
            email={request.email ?? undefined}
            currency={request.currency ?? undefined}
          />
        )}

        {triage.refusal && <Callout tone="danger">{triage.refusal}</Callout>}
      </div>
    </Modal>
  );
}

function confirmLabel(action: RequestTriageAction): string {
  switch (action) {
    case "draft":
      return "Create draft";
    case "offer":
      return "Send offer";
    case "decline":
      return "Decline";
    case "block":
      return "Block sender";
    case "archive":
      return "Archive";
    case "restore":
      return "Restore";
  }
}

interface ActionBodyProps {
  action: RequestTriageAction;
  triage: RequestTriage;
  requester: string;
  /** The profile a Block would report — the sender, which may be an agency. */
  accused: string;
  hasAccount: boolean;
  email?: string;
  currency?: string;
}

function ActionBody({
  action,
  triage,
  requester,
  accused,
  hasAccount,
  email,
  currency,
}: ActionBodyProps) {
  if (action === "decline") {
    return (
      <Paragraph>
        <Strong>{requester}</Strong> will be told this date is a no.{" "}
        {hasAccount
          ? "They get it in their own Requests screen."
          : `They came in from the public form, so there is no account to notify — write to them${email ? ` at ${email}` : ""} if you want to explain.`}{" "}
        You can restore the request later from the Declined filter.
      </Paragraph>
    );
  }

  if (action === "archive") {
    return (
      <Paragraph>
        It leaves your pending inbox and nothing is sent to <Strong>{requester}</Strong>. Find it
        again under the Archived filter, and restore it from there.
      </Paragraph>
    );
  }

  if (action === "restore") {
    return (
      <Paragraph>
        This puts the request back in your pending inbox.{" "}
        {hasAccount ? `${requester} is told it is open again.` : ""}
      </Paragraph>
    );
  }

  if (action === "block") {
    return (
      <>
        <Paragraph>
          This moves the request to Flagged and{" "}
          {hasAccount ? (
            <>
              files a spam report against <Strong>{accused}</Strong>
              {accused !== requester ? ` — the account that sent it, not ${requester}` : ""}. Enough
              separate venues reporting the same account suspends it.
            </>
          ) : (
            <>
              records a spam report. This sender wrote in from the public form and has no account,
              so no profile is accused.
            </>
          )}
        </Paragraph>
        <Callout tone="danger">
          A report cannot be withdrawn from this screen. Archive instead if you only want the
          request out of the way.
        </Callout>
      </>
    );
  }

  if (action === "draft") {
    return (
      <>
        <Paragraph>
          Starts an event from this request — the date, the contact, the asked fee and their message
          all carry over into the draft's notes. It does not answer {requester}.
        </Paragraph>
        <TextField
          label="Event title"
          value={triage.draftTitle}
          placeholder={requester}
          onChange={(event) => triage.setDraftTitle(event.target.value)}
        />
        <DatePickerField
          label="Date"
          value={triage.draftDate}
          onChange={(event) => triage.setDraftDate(event.target.value)}
        />
        <TextField
          label="Currency"
          value={triage.draftCurrency}
          placeholder="SEK"
          onChange={(event) => triage.setDraftCurrency(event.target.value)}
        />
        <Hint>
          The currency the event's budget and settlement are denominated in. It comes from your
          venue's country — set one if this is blank.
        </Hint>
      </>
    );
  }

  return (
    <>
      <Paragraph>
        Your terms go straight to <Strong>{requester}</Strong>
        {hasAccount ? "'s inbox" : email ? ` at ${email}` : ""}. The request stays pending until
        they answer — this is a reply, not an agreement.
      </Paragraph>
      <div style={{ display: "flex", gap: 10 }}>
        <TextField
          label={`Fee from${currency ? ` (${currency})` : ""}`}
          value={triage.feeMinimum}
          placeholder="45000"
          inputMode="decimal"
          onChange={(event) => triage.setFeeMinimum(event.target.value)}
        />
        <TextField
          label={`Fee to${currency ? ` (${currency})` : ""}`}
          value={triage.feeMaximum}
          placeholder="55000"
          inputMode="decimal"
          onChange={(event) => triage.setFeeMaximum(event.target.value)}
        />
      </div>
      <DatePickerField
        label="Date you are offering"
        value={triage.offeredDate}
        onChange={(event) => triage.setOfferedDate(event.target.value)}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Eyebrow>Message</Eyebrow>
        <textarea
          value={triage.message}
          onChange={(event) => triage.setMessage(event.target.value)}
          rows={4}
          placeholder="What you can do, and what you need from them."
          style={{
            background: "var(--elevated)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            color: "var(--text)",
            font: "inherit",
            fontSize: 13.5,
            padding: "10px 12px",
            resize: "vertical",
          }}
        />
      </div>
    </>
  );
}

function Paragraph({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>{children}</p>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <strong style={{ color: "var(--text)" }}>{children}</strong>;
}

function Hint({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>{children}</span>;
}

/** An inline notice that stays put — the reader must be able to read it twice. */
function Callout({ children, tone }: { children: ReactNode; tone: "neutral" | "danger" }) {
  const accent = tone === "danger" ? "var(--brand-red)" : "var(--border)";
  return (
    <output
      style={{
        display: "block",
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${tone === "danger" ? `color-mix(in srgb, ${accent} 45%, transparent)` : accent}`,
        background:
          tone === "danger" ? `color-mix(in srgb, ${accent} 10%, transparent)` : "var(--elevated)",
        color: "var(--text)",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </output>
  );
}
