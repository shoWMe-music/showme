import {
  Avatar,
  type AvatarTone,
  Badge,
  Button,
  Card,
  Icon,
  KeyValueRow,
} from "@showme/design-system";
import { Eyebrow } from "./primitives";

/** The settlement "who owes whom" board (§6, §15.B). Presentational: the screen
 * runs the settlement math and passes the resolved lines + transfers down. Two
 * variants: `full` = the operator's whole board; `slice` = a single party's own
 * card (same data shape, scoped to one participant). */

export type TransferState = "owed" | "paid" | "handled";

const TRANSFER_STATUS = {
  owed: { status: "pending", label: "Owed" },
  paid: { status: "confirmed", label: "Paid" },
  handled: { status: "concluded", label: "Handled" },
} as const;

export interface SettlementLine {
  id: string;
  party: string;
  initials: string;
  tone?: AvatarTone;
  /** Pre-formatted display figures. */
  owed: string;
  collected: string;
  paid: string;
  net: string;
  /** Colour hint for the net figure. */
  netTone?: "positive" | "negative" | "neutral";
}

export interface Transfer {
  id: string;
  from: string;
  to: string;
  /** Pre-formatted amount (e.g. "€2,400"). */
  amount: string;
  state: TransferState;
}

export interface WhoOwesWhomBoardProps {
  participants: SettlementLine[];
  transfers: Transfer[];
  /** `full` (operator, all parties) or `slice` (one party's own card). */
  variant?: "full" | "slice";
  /** Whether Σ net = 0 holds — the screen computes it. */
  balanced?: boolean;
  onMark?: (transferId: string, state: TransferState) => void;
}

function netColor(tone: SettlementLine["netTone"]): string {
  if (tone === "positive") return "var(--brand-gold)";
  if (tone === "negative") return "var(--brand-red)";
  return "var(--text)";
}

function ParticipantLine({ line }: { line: SettlementLine }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar initials={line.initials} tone={line.tone ?? "brand"} size={30} />
        <span style={{ color: "var(--text)", fontWeight: 600 }}>{line.party}</span>
      </div>
      <KeyValueRow label="Owed" value={line.owed} mono />
      <KeyValueRow label="Collected" value={line.collected} mono />
      <KeyValueRow label="Paid" value={line.paid} mono />
      <KeyValueRow label="Net" value={line.net} mono total valueColor={netColor(line.netTone)} />
    </div>
  );
}

function TransferRow({
  transfer,
  onMark,
}: { transfer: Transfer; onMark?: WhoOwesWhomBoardProps["onMark"] }) {
  const meta = TRANSFER_STATUS[transfer.state];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--elevated)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>{transfer.from}</span>
        <Icon name="arrow-right" size={14} />
        <span style={{ color: "var(--text)", fontWeight: 600 }}>{transfer.to}</span>
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)", marginLeft: 6 }}>
          {transfer.amount}
        </span>
      </div>
      <Badge status={meta.status} dot>
        {meta.label}
      </Badge>
      {onMark && transfer.state === "owed" && (
        <Button variant="secondary" onClick={() => onMark(transfer.id, "paid")}>
          Mark as paid
        </Button>
      )}
      {onMark && transfer.state !== "handled" && (
        <Button variant="ghost" onClick={() => onMark(transfer.id, "handled")}>
          Already handled
        </Button>
      )}
    </div>
  );
}

export function WhoOwesWhomBoard({
  participants,
  transfers,
  variant = "full",
  balanced,
  onMark,
}: WhoOwesWhomBoardProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Eyebrow>{variant === "slice" ? "Your settlement" : "Who owes whom"}</Eyebrow>
        {balanced !== undefined && (
          <Badge status={balanced ? "confirmed" : "cancelled"} dot>
            {balanced ? "Σ net = 0" : "Not balanced"}
          </Badge>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: variant === "slice" ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 18,
        }}
      >
        {participants.map((line) => (
          <ParticipantLine key={line.id} line={line} />
        ))}
      </div>

      {transfers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Transfers</Eyebrow>
          {transfers.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} onMark={onMark} />
          ))}
        </div>
      )}
    </Card>
  );
}
