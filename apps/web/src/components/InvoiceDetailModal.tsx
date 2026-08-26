import { type getApiV1InvoicesIid, useGetApiV1InvoicesIid } from "@showme/api-client";
import { Badge, Button, Card, KeyValueRow, Modal } from "@showme/design-system";
import { formatDate, formatMoney } from "../lib/format";
import {
  INVOICE_STATE_STATUS,
  type InvoiceLineItem,
  invoiceDirectionLabel,
  invoiceReference,
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
      title={data ? `Invoice ${invoiceReference(data)}` : "Invoice"}
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
  const links = [
    { label: "Event", id: invoice.eventId },
    { label: "Settlement transfer", id: invoice.transferId },
    { label: "Budget line", id: invoice.budgetLineId },
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
        <KeyValueRow label="Issued" value={formatDate(invoice.issuedAt)} />
        <KeyValueRow label="Due" value={formatDate(invoice.dueDate)} />
      </Card>

      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Eyebrow>Amount</Eyebrow>
        <InvoiceLines items={lineItems} currency={currency} />
        {vat && (
          <KeyValueRow
            label={vat.rate != null ? `VAT ${vat.rate}%` : "VAT"}
            value={vat.amountMinor != null ? formatMoney(vat.amountMinor, currency) : "—"}
            mono
          />
        )}
        <KeyValueRow label="Total" value={formatMoney(invoice.total, currency)} mono total />
      </Card>

      {links.length > 0 && (
        <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow>Linked records</Eyebrow>
          {/* The payload carries ids only — no event or budget-line NAME is served
              here, so the short id is shown rather than a fabricated title. */}
          {links.map((link) => (
            <KeyValueRow
              key={link.label}
              label={link.label}
              value={(link.id as string).slice(0, 8)}
              mono
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

function InvoiceLines({ items, currency }: { items: InvoiceLineItem[]; currency: string }) {
  // A draft raised from the "New invoice" form carries no line items — say so
  // rather than showing an empty block above the total.
  if (items.length === 0) {
    return (
      <span className="muted" style={{ fontSize: 12 }}>
        No line items — this invoice carries a total only.
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
