import type { Status } from "@showme/design-system";

/**
 * Pure readers for an invoice record, shared by the Bills & Invoices ledger row
 * and the invoice detail overlay. They live outside both components so the two
 * surfaces can never disagree about what "overdue" or "the counterparty" means.
 *
 * `GET /profiles/:id/invoices` and `GET /invoices/:iid` serialize the SAME shape
 * (`InvoiceResponse` in `apps/api/src/routes/invoices.ts`), so one structural
 * type covers both and neither surface needs the generated response type.
 */
export interface InvoiceRecord {
  id: string;
  direction: string;
  issuerRef: string | null;
  recipientRef: string | null;
  number: string | null;
  currency: string | null;
  total: string | null;
  dueDate: string | null;
  state: string;
  /** jsonb, so the generated client types it as an optional `unknown`. */
  lineItems?: unknown;
}

/** Invoice document state → design-system status pill. */
export const INVOICE_STATE_STATUS: Record<string, Status> = {
  draft: "draft",
  sent: "pending",
  issued: "pending",
  overdue: "cancelled",
  paid: "confirmed",
  void: "cancelled",
};

export function invoiceStateLabel(state: string): string {
  return state.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

/** An invoice is "overdue" when it's unpaid and its due date has passed. */
export function isInvoiceOverdue(invoice: Pick<InvoiceRecord, "state" | "dueDate">): boolean {
  if (invoice.state === "paid" || invoice.state === "void") return false;
  if (!invoice.dueDate) return false;
  const due = new Date(invoice.dueDate).getTime();
  return Number.isFinite(due) && due < Date.now();
}

/** Who the invoice faces: the recipient when we issued it, the issuer when we owe it. */
export function invoiceCounterparty(
  invoice: Pick<InvoiceRecord, "direction" | "issuerRef" | "recipientRef">,
): string {
  const reference = invoice.direction === "issued" ? invoice.recipientRef : invoice.issuerRef;
  return reference ?? "—";
}

/** The invoice's human handle: its number once issued, else a short id stub. */
export function invoiceReference(invoice: Pick<InvoiceRecord, "number" | "id">): string {
  return invoice.number ?? invoice.id.slice(0, 8);
}

export function invoiceDirectionLabel(direction: string): string {
  return direction === "issued" ? "Issued (receivable)" : "Received (payable)";
}

/**
 * `line_items` is jsonb, so the API types it `unknown` — the client is the first
 * place that can say what a line looks like. The seeded/written shape is
 * `{ label, quantity, unitAmount }` with `unitAmount` in MINOR units as a string
 * (money.md). Anything that doesn't match is dropped rather than guessed at.
 */
export interface InvoiceLineItem {
  label: string;
  quantity: number;
  unitAmountMinor: string | null;
}

export function parseInvoiceLineItems(lineItems: unknown): InvoiceLineItem[] {
  if (!Array.isArray(lineItems)) return [];
  const parsed: InvoiceLineItem[] = [];
  for (const entry of lineItems) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { label?: unknown; quantity?: unknown; unitAmount?: unknown };
    const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : null;
    if (!label) continue;
    parsed.push({
      label,
      quantity:
        typeof item.quantity === "number" && Number.isFinite(item.quantity) ? item.quantity : 1,
      unitAmountMinor: typeof item.unitAmount === "string" ? item.unitAmount : null,
    });
  }
  return parsed;
}

/** First line-item label — the only real descriptor of what an invoice is for. */
export function invoiceLineItemLabel(invoice: Pick<InvoiceRecord, "lineItems">): string | null {
  return parseInvoiceLineItems(invoice.lineItems)[0]?.label ?? null;
}

/** `vat` is jsonb too; the written shape is `{ rate, amount }` (amount in minor units). */
export interface InvoiceVat {
  rate: number | null;
  amountMinor: string | null;
}

export function parseInvoiceVat(vat: unknown): InvoiceVat | null {
  if (!vat || typeof vat !== "object") return null;
  const value = vat as { rate?: unknown; amount?: unknown };
  const rate = typeof value.rate === "number" && Number.isFinite(value.rate) ? value.rate : null;
  const amountMinor = typeof value.amount === "string" ? value.amount : null;
  if (rate == null && amountMinor == null) return null;
  return { rate, amountMinor };
}

/** A line's own money: quantity × unit price, in minor units. */
export function lineItemTotalMinor(item: InvoiceLineItem): number | null {
  if (item.unitAmountMinor == null) return null;
  const unit = Number(item.unitAmountMinor);
  if (!Number.isFinite(unit)) return null;
  return unit * item.quantity;
}
