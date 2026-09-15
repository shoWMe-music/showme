import { Button, Icon, Input } from "@showme/design-system";
import { useState } from "react";
import { formatMoney } from "../lib/format";
import { toMinorUnits } from "../lib/moneyUnits";
import type { LineThread } from "./SettlementActualsCard";
import type { SettlementLineRow } from "./useSettlementLines";

/**
 * EVERY FIGURE THE NIGHT RECORDED, read-only, with a comment thread on each one.
 *
 * The design's "Revenue & deductions" card leads with this list and puts the
 * totals under it — *"read-only preview of the figures entered on Financials.
 * Edit them there."* Ours showed only the totals, so the Settlement tab could
 * state that the night deducted 33 000 without ever saying what of.
 *
 * READ-ONLY IS THE POINT, not a limitation. The editable copy of these rows is
 * one tab across, and two editors for one figure is how a settlement ends up
 * disagreeing with itself. What this card adds is the conversation: the thread is
 * anchored per line, so "the production line looks 500 higher than our copy" is
 * said against the row rather than into a general thread.
 *
 * **The affordance is the design's small bubble on the row**, not a "Comment on
 * this figure" link under each one. Eight identical links down a column is eight
 * times the same words; the icon sits where the design puts it and carries the
 * row's name for anyone not looking at the pointer.
 */
export function SettlementLinePreview({
  lines,
  currency,
  thread,
}: { lines: SettlementLineRow[]; currency: string; thread?: LineThread }) {
  // Which row's composer is open — at most one, because a settlement comment is
  // about a figure and opening six boxes invites a remark that names none.
  const [openLineId, setOpenLineId] = useState<string | null>(null);

  if (lines.length === 0) return null;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      {lines.map((row, index) => (
        <div
          key={row.id}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "10px 14px",
            borderTop: index === 0 ? undefined : "1px solid var(--border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13, minWidth: 0, overflowWrap: "anywhere" }}>{row.label}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              {thread && (
                <CommentBubble
                  row={row}
                  count={thread.forLine(row.id).length}
                  onClick={() => setOpenLineId(openLineId === row.id ? null : row.id)}
                />
              )}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  // A cost is drawn as the subtraction it is, in the same red the
                  // waterfall's deduction row uses, so the two agree about what a
                  // negative figure looks like on this screen.
                  color: row.kind === "cost" ? "var(--brand-red)" : "var(--text)",
                }}
              >
                {row.kind === "cost" ? "−" : ""}
                {formatMoney(toMinorUnits(row.amount), currency)}
              </span>
            </div>
          </div>

          {/* Remarks already made are shown ALWAYS. Hiding a question behind a
              click is how a question goes unanswered; hiding an empty box is
              just tidiness. */}
          {thread?.forLine(row.id).map((comment) => (
            <div key={comment.id} style={{ fontSize: 12, color: "var(--muted)" }}>
              <span style={{ color: "var(--text)" }}>{comment.author}</span>: {comment.message}
            </div>
          ))}

          {thread && openLineId === row.id && (
            <Composer row={row} thread={thread} onDone={() => setOpenLineId(null)} />
          )}
        </div>
      ))}
    </div>
  );
}

function CommentBubble({
  row,
  count,
  onClick,
}: { row: SettlementLineRow; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // NAMED FOR ITS ROW. "Comment on this figure" repeated down a column is one
      // label many times over to anybody not looking at where the pointer is —
      // and the row is the entire meaning of the control.
      aria-label={`${count > 0 ? "Reply about" : "Comment on"} ${row.label}`}
      title={`${count > 0 ? "Reply about" : "Comment on"} ${row.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "none",
        border: "none",
        padding: 2,
        cursor: "pointer",
        color: count > 0 ? "var(--brand-red)" : "var(--dim)",
      }}
    >
      <Icon name="message" size={14} />
      {count > 0 && <span style={{ fontSize: 11 }}>{count}</span>}
    </button>
  );
}

function Composer({
  row,
  thread,
  onDone,
}: { row: SettlementLineRow; thread: LineThread; onDone: () => void }) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const message = draft.trim();
    if (message === "") return;
    thread.post(message, row.id);
    setDraft("");
    onDone();
  };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <div style={{ flex: "1 1 220px" }}>
        <Input
          value={draft}
          autoFocus
          placeholder={`About ${row.label}…`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && send()}
          aria-label={`Your comment on ${row.label}`}
        />
      </div>
      <Button variant="secondary" disabled={draft.trim() === ""} onClick={send}>
        Post
      </Button>
    </div>
  );
}
