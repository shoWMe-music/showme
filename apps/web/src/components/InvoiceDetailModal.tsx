import { type getApiV1InvoicesIid, useGetApiV1InvoicesIid } from "@showme/api-client";
import { Badge, Button, Card, KeyValueRow, Modal } from "@showme/design-system";
import { formatDay, formatMoney } from "../lib/format";
import {
  INVOICE_STATE_STATUS,
  type InvoiceLineItem,
  invoiceAmountText,
  invoiceDirectionLabel,
  invoiceStateLabel,
  isInvoiceOverdue,
  lineItemTotalMinor,
  parseInvoiceLineItems,
  parseInvoiceVat,
} from "./invoiceDocument";
import { Eyebrow } from "./primitives";
import { ErrorState, LoadingState } from "./states";

type InvoiceDetail = Awaited<ReturnType<typeof getApiV1InvoicesIid>>;

/**
 * The invoice document, opened from a ledger row.
 *
 * A modal rather than a routed page: an invoice is a leaf record with no
 * sub-navigation, and every read-only record in this app that isn't the event
 * workspace is shown over its list (see `AgreementView` inside the event screen,
 * and the design system's `Modal`, whose stated job is "profile modals, venue
 * specs, deal editors"). Keeping it here also keeps the ledger's tab, filters and
 * scroll position alive behind the overlay.
 *
 * It renders ONLY what `GET /invoices/:iid` returns — no invented fields.
 */
export function InvoiceDetailModal({
  invoiceId,
  onClose,
}: { invoiceId: string | null; onClose: () => void }) {
  const { data, isPending, isError, error } = useGetApiV1InvoicesIid(invoiceId ?? "", {
    query: { enabled: Boolean(invoiceId) },
  });

  return (
    <Modal
      open={Boolean(invoiceId)}
      onClose={onClose}
      /* An un-numbered invoice is titled just "Invoice" — `invoiceReference` returns the
         em dash for the column it was written for, and "Invoice —" is not a title
         (QA7-27). A received bill has no number of ours by design. */
      title={data?.number ? `Invoice ${data.number}` : "Invoice"}
      width={620}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isPending ? (
        <LoadingState label="Loading invoice" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load this invoice" />
      ) : (
        <InvoiceDocument invoice={data} />
      )}
    </Modal>
  );
}

function InvoiceDocument({ invoice }: { invoice: InvoiceDetail }) {
  const overdue = isInvoiceOverdue(invoice);
  const status = INVOICE_STATE_STATUS[overdue ? "overdue" : invoice.state] ?? "draft";
  const currency = invoice.currency ?? "EUR";
  const lineItems = parseInvoiceLineItems(invoice.lineItems);
  const vat = parseInvoiceVat(invoice.vat);
  /*
   * LINKED RECORDS, BY NAME (QA sweep run 17, QA17-9).
   *
   * This printed `(link.id as string).slice(0, 8)` — `Event e2e00000`, `Budget line a7bcdf1b` — for
   * records that have names, with a comment admitting the payload carried ids only. It does now, on
   * the detail read this modal is the only reader of.
   *
   * The transfer keeps its short id: a settlement transfer has no name to serve, and the operator
   * reconciling a bill against a payout does use the prefix to match the two. So the rule is
   * per-row — a NAME where one exists, and an id only where the id IS the identifier.
   */
  const links = [
    { label: "Event", id: invoice.eventId, name: invoice.eventTitle ?? null },
    { label: "Settlement transfer", id: invoice.transferId, name: null },
    { label: "Budget line", id: invoice.budgetLineId, name: invoice.budgetLineLabel ?? null },
  ].filter((link) => Boolean(link.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <Badge status={status} dot>
          {overdue ? "Overdue" : invoiceStateLabel(invoice.state)}
        </Badge>
        <Eyebrow>{invoiceDirectionLabel(invoice.direction)}</Eyebrow>
      </div>

      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Eyebrow>Parties</Eyebrow>
        <KeyValueRow label="From" value={invoice.issuerRef ?? "—"} />
        <KeyValueRow label="To" value={invoice.recipientRef ?? "—"} />
      </Card>

      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Eyebrow>Dates</Eyebrow>
        <KeyValueRow label="Issued" value={formatDay(invoice.issuedAt)} />
        <KeyValueRow label="Due" value={formatDay(invoice.dueDate)} />
      </Card>

      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Eyebrow>Amount</Eyebrow>
        <InvoiceLines items={lineItems} currency={currency} hasTotal={invoice.total != null} />
        {vat && (
          <KeyValueRow
            label={vat.rate != null ? `VAT ${vat.rate}%` : "VAT"}
            value={vat.amountMinor != null ? formatMoney(vat.amountMinor, currency) : "—"}
            mono
          />
        )}
        <KeyValueRow label="Total" value={invoiceAmountText(invoice, currency)} mono total />
      </Card>

      {links.length > 0 && (
        <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow>Linked records</Eyebrow>
          {links.map((link) => (
            <KeyValueRow
              key={link.label}
              label={link.label}
              // A name reads as itself; an id is only ever a prefix to match against.
              value={link.name ?? (link.id as string).slice(0, 8)}
              mono={link.name == null}
            />
          ))}
        </Card>
      )}

      {invoice.documentSnapshot != null && (
        <span className="muted" style={{ fontSize: 12 }}>
          Frozen on issue — this document can no longer be edited, only its state can move.
        </span>
      )}
    </div>
  );
}

function InvoiceLines({
  items,
  currency,
  hasTotal,
}: { items: InvoiceLineItem[]; currency: string; hasTotal: boolean }) {
  // A draft raised from the "New invoice" form carries no line items — say so
  // rather than showing an empty block above the total.
  //
  // "…carries a total only" was untrue of the one invoice that has NEITHER, which is
  // the same draft QA9-12 is about: the row above now reads `Total —`, and a sentence
  // promising a total sat directly over the dash saying there is none.
  if (items.length === 0) {
    return (
      <span className="muted" style={{ fontSize: 12 }}>
        {hasTotal
          ? "No line items: this invoice carries a total only."
          : "Nothing itemised and no total yet: this draft is still being written."}
      </span>
    );
  }
  return (
    <>
      {items.map((item) => {
        const totalMinor = lineItemTotalMinor(item);
        return (
          <KeyValueRow
            key={item.label}
            label={item.quantity === 1 ? item.label : `${item.label} × ${item.quantity}`}
            value={totalMinor != null ? formatMoney(totalMinor, currency) : "—"}
            mono
          />
        );
      })}
    </>
  );
}
