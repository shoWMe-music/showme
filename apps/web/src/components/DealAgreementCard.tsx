import { Badge, Button, Card, Icon, type Status } from "@showme/design-system";
import { DEAL_PARTY_ROLE_OPTIONS, basisPointsToPercent, shareBasisPointsOf } from "@showme/shared";
import { type AgreementField, AgreementView } from "./AgreementView";
import type { ScheduleEntry } from "./ScheduleList";
import { Eyebrow } from "./primitives";
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
  summary: AgreementField[];
  dealStructure: AgreementField[];
  schedule: ScheduleEntry[];
  parties: DealPartyLine[];
  actions: DealActions;
  busy: boolean;
  onSend: (dealId: string) => void;
  onConfirm: (dealId: string) => void;
  onReopen: (dealId: string) => void;
  onExportPdf: () => void;
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
 */
export function DealAgreementCard({
  dealId,
  name,
  agreementStatus,
  summary,
  dealStructure,
  schedule,
  parties,
  actions,
  busy,
  onSend,
  onConfirm,
  onReopen,
  onExportPdf,
}: DealAgreementCardProps) {
  const frozen = agreementStatus === "confirmed" || agreementStatus === "signed";
  const signatories = parties.filter((party) => party.roleInDeal !== "observer");
  const signed = signatories.filter((party) => party.confirmedAt != null).length;
  // Whether this card is looking at the WHOLE agreement or one slice of it. Every
  // visible line being the caller's own means the server redacted the rest
  // (`serializeDeal`), and a card that counted "1 of 1 confirmed" over a redaction
  // would be telling a performer her signature is the last one needed — a rollup
  // she is not shown and cannot compute. The real rollup is `agreementStatus`,
  // which the server does compute across every party.
  const seesEveryLine = parties.some((party) => !party.isYours);

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text)", fontWeight: 600, fontSize: 15 }}>{name}</span>
          <Badge status={agreementBadgeStatus(agreementStatus)} dot>
            {AGREEMENT_STATUS_LABEL[agreementStatus] ?? agreementStatus}
          </Badge>
        </div>
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
          {actions.canReopen && (
            <Button variant="secondary" disabled={busy} onClick={() => onReopen(dealId)}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      <AgreementView
        frozen={frozen}
        confirmationLabel={
          seesEveryLine
            ? `All ${signatories.length} parties confirmed`
            : "Every party confirmed — terms frozen"
        }
        // Terms are live until every party signs, but "Draft" is only true before
        // they were sent — after that they are out for confirmation, not a draft.
        draftLabel={
          agreementStatus === "draft" ? "Draft — editable" : "Terms live until every party signs"
        }
        summary={summary}
        dealStructure={dealStructure}
        schedule={schedule}
        onExportPdf={onExportPdf}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Eyebrow>
          {seesEveryLine ? `Parties — ${signed} of ${signatories.length} confirmed` : "Your line"}
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
            The other parties' lines on this agreement aren't shared with you.
          </span>
        )}
      </div>
    </Card>
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
        background: "var(--elevated)",
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
