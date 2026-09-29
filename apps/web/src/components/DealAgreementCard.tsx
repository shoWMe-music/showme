import { Badge, Button, Card, Icon, type Status } from "@showme/design-system";
import {
  DEAL_PARTY_ROLE_OPTIONS,
  basisPointsToPercent,
  shareBasisPointsOf,
  termsAreSealed,
} from "@showme/shared";
import { useId } from "react";
import { type AgreementField, AgreementView } from "./AgreementView";
import type { ScheduleEntry } from "./ScheduleList";
import { Eyebrow } from "./primitives";
import { useCollapseMotion } from "./useCollapseMotion";
import type { DealActions } from "./useEventAgreements";

/** One party line, resolved for display: who, in what role, and whether they signed. */
export interface DealPartyLine {
  id: string;
  name: string;
  roleInDeal: string;
  /** ISO timestamp of this party's own confirmation, or null. */
  confirmedAt: string | null;
  /** The caller stands behind this line — the one they may confirm (#1). */
  isYours: boolean;
  /** Stated share of the payout, already formatted ("40%"), or null. */
  shareLabel: string | null;
}

export interface DealAgreementCardProps {
  dealId: string;
  name: string;
  agreementStatus: string;
  /**
   * THE DEAL'S OWN STATUS — `draft` | `confirmed` | `cancelled` (QA sweep run 10, QA10-9).
   *
   * A different column from `agreementStatus`, and the card did not receive it, so it could not say
   * the one thing a reader most needs to know: a **cancelled** agreement read as
   * *"Sent — awaiting confirmations"* with a live *Confirm your line* button, in both operators' seats.
   * The only trace of the cancellation was the absence of the Cancel button — an absence, which is the
   * weakest evidence there is.
   */
  dealStatus: string;
  summary: AgreementField[];
  dealStructure: AgreementField[];
  schedule: ScheduleEntry[];
  parties: DealPartyLine[];
  actions: DealActions;
  busy: boolean;
  /** The agreement's terms & conditions as written, or null when none is. */
  termsText: string | null;
  /** Whether this caller may write them — never once the terms are frozen. */
  onEditTerms: () => void;
  onSend: (dealId: string) => void;
  onConfirm: (dealId: string) => void;
  onReopen: (dealId: string) => void;
  /** Destroy a draft nothing has been settled against, or stop one paying (§25.7.2). */
  onDelete: (dealId: string) => void;
  onCancel: (dealId: string) => void;
  /** Open the composer on this deal's own figures (QA8-1). */
  onReviseTerms: (dealId: string) => void;
  onExportPdf: () => void;
  /** Whether the terms, party lines and export are showing. */
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * One agreement, with the lifecycle attached to it.
 *
 * The tab used to render the terms and stop there, which made a deal a document
 * rather than an agreement: the three moves that turn terms into a commitment —
 * send, confirm, reopen — had no surface at all. They are here, and each appears
 * only when the route behind it would accept the call.
 *
 * The party list is the other half. Confirmation is a **per-party act**, so what
 * matters is not "is this deal confirmed" but "which parties have signed, and is
 * one of them me". A shared split shows each performer only their own line
 * (the server decides that, not this card), so what is rendered here is exactly
 * what the caller is allowed to know — with their own line marked, because it is
 * the only one they can act on.
 *
 * COLLAPSIBLE, because an event carries several of these and every one of them
 * fully open is a wall. What survives the fold is chosen so a collapsed card is
 * still an ANSWER and not just a title: the deal's name (which deal), the
 * `agreement_status` badge (what state), a signature rollup (how far it got),
 * and the whole action strip (what is still mine to do). A card that hid whether
 * the deal was signed would only be a wall you also had to click through.
 * Which cards start open is `useDealCardExpansion`; the fold itself is
 * `useCollapseMotion`.
 */
export function DealAgreementCard({
  dealId,
  name,
  agreementStatus,
  dealStatus,
  summary,
  dealStructure,
  schedule,
  parties,
  actions,
  busy,
  termsText,
  onEditTerms,
  onSend,
  onConfirm,
  onReopen,
  onDelete,
  onCancel,
  onReviseTerms,
  onExportPdf,
  expanded,
  onToggleExpanded,
}: DealAgreementCardProps) {
  /*
   * SEALED AT THE FIRST SIGNATURE, NOT THE LAST — and asked, not restated.
   *
   * This line used to be `agreementStatus === "confirmed" || "signed"`, which was the rule until
   * part 29 moved the seal to the first signature at the server. The card then spent eight days
   * saying "Terms live until every party signs" over a live Write terms button on a deal the API
   * refuses with a 409 (QA sweep run 12's only MAJOR), and `routes/deals.ts` had a comment
   * promising this exact surface asked `termsAreSealed` — a comment that states a rule is a test
   * that never runs.
   *
   * Both arguments were already on this component. One function, three readers: here, the terms
   * editor's `canEditTerms` in `useEventAgreements`, and the route itself.
   */
  const frozen = termsAreSealed({ agreementStatus }, parties);
  /*
   * Cancelled OUTRANKS the agreement's own status everywhere it is shown. A withdrawn deal that still
   * reads "awaiting confirmations" is inviting a signature the server now refuses (QA10-9), and it
   * was collecting them before it did.
   */
  const cancelled = dealStatus === "cancelled";
  const signatories = parties.filter((party) => party.roleInDeal !== "observer");
  const signed = signatories.filter((party) => party.confirmedAt != null).length;
  // Whether this card is looking at the WHOLE agreement or one slice of it. Every
  // visible line being the caller's own means the server redacted the rest
  // (`serializeDeal`), and a card that counted "1 of 1 confirmed" over a redaction
  // would be telling a performer her signature is the last one needed — a rollup
  // she is not shown and cannot compute. The real rollup is `agreementStatus`,
  // which the server does compute across every party.
  const seesEveryLine = parties.some((party) => !party.isYours);
  // The rollup the COLLAPSED header has to carry. The status badge beside it says
  // what state the deal is in; this says how far the signatures got, which is the
  // other half of "can I skip this card". It obeys the same redaction rule as the
  // party list below: a caller shown only her own line is told about her own line
  // and nothing else, because the count over a slice would be a lie.
  const yourLine = parties.find((party) => party.isYours);
  const signatureSummary = seesEveryLine
    ? signatories.length > 0
      ? `${signed} of ${signatories.length} signed`
      : null
    : yourLine
      ? yourLine.confirmedAt
        ? "Your line signed"
        : "Your line unsigned"
      : null;

  const bodyId = useId();
  const collapse = useCollapseMotion(expanded);

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {/* The disclosure trigger is the IDENTITY half of the header, not the
            whole row: the action strip beside it holds real buttons, and a
            button inside a button is invalid markup and unreachable by keyboard.
            Everything it contains is what a collapsed card still has to answer —
            which deal, with whom it stands, and how far it got. */}
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={bodyId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            flex: "1 1 auto",
            minWidth: 0,
            textAlign: "left",
            padding: 0,
            border: 0,
            background: "transparent",
            color: "inherit",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              color: "var(--muted)",
              transform: expanded ? "none" : "rotate(-90deg)",
              // The token, so `prefers-reduced-motion` zeroes it with everything
              // else — the same base speed the body's height takes, so the arrow
              // and the fold land together.
              transition: "transform var(--duration-base) var(--ease-out)",
            }}
          >
            <Icon name="chevron-down" size={16} />
          </span>
          <span style={{ color: "var(--text)", fontWeight: 600, fontSize: 15 }}>{name}</span>
          <Badge status={cancelled ? "cancelled" : agreementBadgeStatus(agreementStatus)} dot>
            {cancelled
              ? "Cancelled — withdrawn"
              : (AGREEMENT_STATUS_LABEL[agreementStatus] ?? agreementStatus)}
          </Badge>
          {signatureSummary && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted)" }}>
              {signatureSummary}
            </span>
          )}
        </button>
        {/* The lifecycle stays in the header, collapsed or not. The whole point
            of folding a settled deal away is to get at the one that still needs
            something done to it — hiding "Send to parties" behind an expand
            would put the action back under the wall it was folded out of. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {actions.canSend && (
            <Button
              variant="primary"
              disabled={busy}
              leftIcon={<Icon name="mail" size={14} />}
              onClick={() => onSend(dealId)}
            >
              Send to parties
            </Button>
          )}
          {actions.canConfirm && (
            <Button
              variant="primary"
              disabled={busy}
              leftIcon={<Icon name="check" size={14} />}
              onClick={() => onConfirm(dealId)}
            >
              Confirm your line
            </Button>
          )}
          {actions.canReviseTerms && (
            /*
             * THE FIGURES, WHILE NOBODY HAS SIGNED (QA sweep run 8, QA8-1).
             *
             * The card said *"Terms live until every party signs"* and offered no way to change
             * one — `PATCH /deals/:id` accepted the write all along and the planner re-seeded
             * from it, exactly as Ran's 2026-09-21 spec asks; there was simply no control. It
             * is hidden once the agreement is signed because the server refuses it there, which
             * is the rule this stretch has applied five times: never offer what the API will
             * refuse.
             */
            <Button
              variant="secondary"
              disabled={busy}
              leftIcon={<Icon name="pencil" size={14} />}
              onClick={() => onReviseTerms(dealId)}
            >
              Edit figures
            </Button>
          )}
          {actions.canReopen && (
            <Button variant="secondary" disabled={busy} onClick={() => onReopen(dealId)}>
              Reopen
            </Button>
          )}
          {/*
           * ENDING IT — delete while it is a draft nothing was settled against, cancel otherwise
           * (decisions §25.7.2, Daniel 2026-09-28). `DELETE /deals/:did` was built and called by
           * nothing, so a deal typed with the wrong guarantee could be neither corrected nor
           * removed, and the only remedy on screen was a second deal on the same event — which
           * double-counts at settlement. Cancelling had no control anywhere in the app either.
           *
           * Exactly one of the three appears. The reason is shown in the third case rather than a
           * greyed-out button, because "why not" here has a useful answer and it is the Cancel
           * control sitting next to it.
           */}
          {actions.canDelete ? (
            <Button
              variant="ghost"
              disabled={busy}
              leftIcon={<Icon name="trash" size={14} />}
              onClick={() => onDelete(dealId)}
            >
              Delete draft
            </Button>
          ) : (
            actions.deleteBlockedReason !== null && (
              <span
                style={{ fontSize: 11.5, color: "var(--muted)", maxWidth: 260, lineHeight: 1.45 }}
              >
                {actions.deleteBlockedReason}
              </span>
            )
          )}
          {actions.canCancel && (
            <Button variant="ghost" disabled={busy} onClick={() => onCancel(dealId)}>
              Cancel agreement
            </Button>
          )}
        </div>
      </div>

      {/* `inert` rather than unmounting: the terms stay in the DOM so the fold
          has something to measure, and `inert` is what stops a collapsed card
          from holding a dozen invisible tab stops. The 16px that separates the
          header from the terms is INSIDE the clip (`paddingTop` on the content,
          not `gap` on the card) — as a gap it would survive a height of zero and
          leave every collapsed card wearing 16px of empty floor. */}
      <div ref={collapse.wrapper} id={bodyId} inert={!expanded} style={{ overflow: "hidden" }}>
        <div
          ref={collapse.content}
          style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 16 }}
        >
          <AgreementView
            frozen={frozen}
            // Frozen terms and a full set of signatures are two different claims, and
            // this used to make the second one whenever the first was true. On a deal
            // whose status reads `confirmed` while a party's line is still unsigned —
            // the seeded Album Release is one — the card said "All 3 parties
            // confirmed" directly above "Parties — 2 of 3 confirmed". Counted, it
            // says what it can see; uncounted (a redacted slice), it reports only the
            // status, which is the one rollup the server does compute across parties.
            confirmationLabel={
              seesEveryLine
                ? signed === signatories.length
                  ? `All ${signatories.length} parties confirmed`
                  : `Terms frozen — ${signed} of ${signatories.length} parties signed`
                : "Terms frozen by the parties"
            }
            /*
             * THE THIRD COPY OF THE RULE PART 29 MOVED (QA sweep run 14).
             *
             * This said "Terms live until every party signs" — the rule before part 29 moved the
             * seal to the FIRST signature. The editor's hint says it correctly ("They freeze when
             * the first party signs", `lib/errors.ts`) and so does the 409; this was the survivor,
             * giving the operator a deadline that is not the real one. It takes the editor's words
             * rather than a third phrasing, because a rule written three times disagreed with
             * itself once already.
             *
             * Reached only while nothing is sealed yet (`frozen` picks `confirmationLabel`
             * otherwise), and "Draft" is only true before it was sent — after that the terms are
             * out for confirmation, not a draft.
             */
            draftLabel={
              cancelled
                ? // There is nothing left to sign, which is the whole of what cancelling means
                  // (decisions §25.7.2).
                  "Cancelled — these terms pay nobody"
                : agreementStatus === "draft"
                  ? "Draft — editable"
                  : "Terms live until the first party signs"
            }
            summary={summary}
            dealStructure={dealStructure}
            schedule={schedule}
            onExportPdf={onExportPdf}
          />

          <DealTermsBlock
            termsText={termsText}
            canEdit={actions.canEditTerms}
            frozen={frozen}
            onEdit={onEditTerms}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Eyebrow>
              {seesEveryLine
                ? `Parties — ${signed} of ${signatories.length} confirmed`
                : "Your line"}
            </Eyebrow>
            {parties.map((party) => (
              <PartyRow key={party.id} party={party} />
            ))}
            {!seesEveryLine && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--dim)",
                  fontSize: 12,
                }}
              >
                <Icon name="eye-off" size={13} />
                The other parties' lines on this deal aren't shared with you.
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * The agreement's words, beside its figures.
 *
 * The terms are deal-level and every party signs the same ones, so unlike the
 * party lines there is nothing to redact here — a signatory who could not read
 * what they are confirming would be being asked to sign blind. Once frozen the
 * text stays visible and the edit disappears: it is part of what
 * `confirmed_snapshot` recorded, and changing it under a signature is exactly
 * what the freeze exists to prevent.
 */
function DealTermsBlock({
  termsText,
  canEdit,
  frozen,
  onEdit,
}: {
  termsText: string | null;
  canEdit: boolean;
  frozen: boolean;
  onEdit: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Eyebrow>Terms &amp; conditions</Eyebrow>
        {canEdit && (
          <Button variant="ghost" leftIcon={<Icon name="pencil" size={14} />} onClick={onEdit}>
            {termsText ? "Edit terms" : "Write terms"}
          </Button>
        )}
      </div>
      {termsText ? (
        <p
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            color: "var(--text)",
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          {termsText}
        </p>
      ) : (
        <span style={{ color: "var(--dim)", fontSize: 12.5 }}>
          {frozen
            ? "No terms were written before this deal was signed."
            : "No terms written yet: the figures above are the whole of this deal."}
        </span>
      )}
    </div>
  );
}

function PartyRow({ party }: { party: DealPartyLine }) {
  const roleLabel =
    DEAL_PARTY_ROLE_OPTIONS.find((option) => option.value === party.roleInDeal)?.label ??
    party.roleInDeal;
  const observer = party.roleInDeal === "observer";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "9px 12px",
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card)",
      }}
    >
      <span style={{ color: "var(--text)", fontWeight: 600 }}>{party.name}</span>
      <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{roleLabel}</span>
      {party.shareLabel && (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)", fontSize: 12.5 }}>
          {party.shareLabel}
        </span>
      )}
      {party.isYours && (
        <Badge status="draft" dot>
          Your line
        </Badge>
      )}
      <span style={{ flex: 1 }} />
      {observer ? (
        <span style={{ color: "var(--dim)", fontSize: 12 }}>Signs nothing</span>
      ) : (
        <Badge status={party.confirmedAt ? "confirmed" : "pending"} dot>
          {party.confirmedAt ? "Confirmed" : "Awaiting confirmation"}
        </Badge>
      )}
    </div>
  );
}

/** The `agreement_status` enum in the words the parties would use (decisions #1). */
const AGREEMENT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft — not sent",
  sent: "Sent — awaiting confirmations",
  confirmed: "Confirmed — terms frozen",
  signed: "Signed",
};

function agreementBadgeStatus(agreementStatus: string): Status {
  if (agreementStatus === "confirmed" || agreementStatus === "signed") return "confirmed";
  if (agreementStatus === "sent") return "pending";
  return "draft";
}

/** A party's stated share as a percentage label, or null when it states none. */
export function shareLabelOf(share: unknown): string | null {
  const basisPoints = shareBasisPointsOf(share);
  return basisPoints == null ? null : `${basisPointsToPercent(basisPoints)}%`;
}
