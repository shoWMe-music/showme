import { Badge, Button } from "@showme/design-system";
import type { KeyboardEvent, MouseEvent } from "react";
import { formatDate, formatMoney } from "../lib/format";
import {
  INVOICE_STATE_STATUS,
  type InvoiceRecord,
  invoiceCounterparty,
  invoiceLineItemLabel,
  invoiceReference,
  invoiceStateLabel,
  isInvoiceOverdue,
} from "./invoiceDocument";

/**
 * The Bills & Invoices ledger: a bordered card with a mono header row and one
 * grid row per invoice, matching the Claude Design prototype's bills table.
 *
 * Why this is hand-rolled instead of the design system's `DataTable`: passing
 * `DataTable` an `onRowClick` turns the whole row into a `<button>`, and this row
 * already contains the "Issue" button — a button inside a button is invalid HTML.
 * `EventList` on the Events screen hand-rolls the same table for the same reason;
 * the measurements below are copied from `DataTable.module.css` so the two tables
 * stay pixel-identical.
 *
 * Presentational — the screen owns the queries, the mutation and the overlay.
 */

const GRID_COLUMNS = "1.6fr 1.6fr 1fr 1fr 1fr 1fr 0.8fr";

const HEADER_CELLS: { label: string; align?: "right" }[] = [
  { label: "Vendor" },
  { label: "Event / Reference" },
  { label: "Category" },
  { label: "Due" },
  { label: "Amount", align: "right" },
  { label: "Status" },
  { label: "", align: "right" },
];

export interface InvoiceLedgerTableProps {
  rows: InvoiceRecord[];
  onOpenInvoice: (invoiceId: string) => void;
  onIssueInvoice: (invoiceId: string) => void;
  /** Disables the Issue button while its request is in flight. */
  isIssuing: boolean;
}

export function InvoiceLedgerTable({
  rows,
  onOpenInvoice,
  onIssueInvoice,
  isIssuing,
}: InvoiceLedgerTableProps) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLUMNS,
          gap: 12,
          padding: "13px 22px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "var(--dim)",
        }}
      >
        {HEADER_CELLS.map((cell, index) => (
          <span
            key={cell.label || `actions-${index}`}
            style={cell.align === "right" ? { textAlign: "right" } : undefined}
          >
            {cell.label}
          </span>
        ))}
      </div>

      {rows.map((invoice) => (
        <InvoiceLedgerRow
          key={invoice.id}
          invoice={invoice}
          onOpenInvoice={onOpenInvoice}
          onIssueInvoice={onIssueInvoice}
          isIssuing={isIssuing}
        />
      ))}
    </div>
  );
}

function InvoiceLedgerRow({
  invoice,
  onOpenInvoice,
  onIssueInvoice,
  isIssuing,
}: { invoice: InvoiceRecord } & Omit<InvoiceLedgerTableProps, "rows">) {
  const reference = invoiceReference(invoice);
  const label = invoiceLineItemLabel(invoice);
  const overdue = isInvoiceOverdue(invoice);
  const status = INVOICE_STATE_STATUS[overdue ? "overdue" : invoice.state] ?? "draft";

  const open = () => onOpenInvoice(invoice.id);

  return (
    <div
      // Clicking anywhere in the row opens the invoice. The keyboard route is the
      // vendor button below, NOT a role/tabIndex on this div: the row already
      // contains real buttons (the vendor name, "Issue"), so making it a button too
      // would nest interactive elements. Same solution as `CalendarMonthGrid`'s day
      // cell. This handler serves a keyboard user who focused the row itself and
      // ignores keys bubbling up from those inner controls.
      onClick={open}
      onKeyDown={(keyEvent: KeyboardEvent<HTMLDivElement>) => {
        if (keyEvent.target !== keyEvent.currentTarget) return;
        if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
        keyEvent.preventDefault();
        open();
      }}
      onMouseEnter={(mouse) => {
        mouse.currentTarget.style.background = "var(--shape-fill)";
      }}
      onMouseLeave={(mouse) => {
        mouse.currentTarget.style.background = "transparent";
      }}
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLUMNS,
        gap: 12,
        alignItems: "center",
        padding: "15px 22px",
        borderTop: "1px solid var(--border)",
        background: "transparent",
        fontSize: 13,
        cursor: "pointer",
        transition: "background var(--duration-quick) var(--ease-out)",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <button
          type="button"
          // The row's keyboard equivalent: already in the tab order, so opening the
          // invoice from here costs no extra tab stop and needs no ARIA gymnastics.
          onClick={(clickEvent: MouseEvent<HTMLButtonElement>) => {
            clickEvent.stopPropagation();
            open();
          }}
          style={{
            padding: 0,
            border: 0,
            background: "transparent",
            font: "inherit",
            fontWeight: 700,
            color: "var(--text)",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {invoiceCounterparty(invoice)}
        </button>
      </span>

      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block" }}>{label ?? reference}</span>
        {label && (
          <span className="muted" style={{ display: "block", fontSize: 12 }}>
            {reference}
          </span>
        )}
      </span>

      {/* No category field on the invoice payload yet — honest placeholder. */}
      <span className="muted">—</span>

      <span>{formatDate(invoice.dueDate)}</span>

      <span style={{ textAlign: "right" }}>
        {formatMoney(invoice.total, invoice.currency ?? "EUR")}
      </span>

      <span>
        <Badge status={status} dot>
          {overdue ? "Overdue" : invoiceStateLabel(invoice.state)}
        </Badge>
      </span>

      <span style={{ textAlign: "right" }}>
        {invoice.state === "draft" && (
          <Button
            variant="ghost"
            // Stop the click here: issuing is its own action, not "open the invoice".
            onClick={(clickEvent: MouseEvent<HTMLButtonElement>) => {
              clickEvent.stopPropagation();
              onIssueInvoice(invoice.id);
            }}
            disabled={isIssuing}
          >
            Issue
          </Button>
        )}
      </span>
    </div>
  );
}
