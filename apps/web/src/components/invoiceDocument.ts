import type { Status } from "@showme/design-system";
import { isCurrencyCode, majorToMinor } from "@showme/shared";

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

/**
 * WHETHER THIS INVOICE IS MONEY THAT IS STILL MOVING (QA7-13).
 *
 * A `draft` is not. The ledger's tiles counted one, so a bill nobody had issued was
 * totalled under *"Bills you owe"* and an invoice nobody had sent under *"Invoices
 * you've issued"* — each tile's own subtitle stating the rule its total broke, with
 * the row beside it still badged **Draft** and offering an **Issue** button.
 *
 * It is a DENY-list, not an allow-list of `sent | overdue`, and that is deliberate:
 * a state this app has not met yet should land in the total rather than vanish from
 * it. Money missing from a sum is a worse failure than money shown a state early,
 * because nothing on the screen reveals it.
 */
export function countsAsMoneyOwed(invoice: Pick<InvoiceRecord, "state">): boolean {
  // `draft` has not been issued, `paid` has landed, `void` was called off.
  return invoice.state !== "draft" && invoice.state !== "paid" && invoice.state !== "void";
}

/**
 * An invoice is "overdue" when money is still moving on it and its due date passed.
 *
 * This used to exclude only `paid` and `void`, so a DRAFT whose date had slipped was
 * counted as overdue — the same defect as QA7-13 one function over, and invisible in
 * the sweep only because the drafts it typed had no due date yet.
 */
export function isInvoiceOverdue(invoice: Pick<InvoiceRecord, "state" | "dueDate">): boolean {
  if (!countsAsMoneyOwed(invoice)) return false;
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

/**
 * The invoice's human handle: its number, or nothing (QA sweep run 7, QA7-27).
 *
 * This fell back to `id.slice(0, 8)`, which printed `1ec9843d` in the EVENT / REFERENCE
 * column and titled the document *"Invoice 1ec9843d"* — a value that looks like a
 * reference, is not one, and cannot be quoted to anybody. Two rows legitimately have no
 * number: a RECEIVED bill, where the reference is the vendor's and is theirs to supply,
 * and an issued invoice before `POST /invoices/:id/issue` assigns one.
 *
 * `—` is the app's own word for "nothing to show here" and what `invoiceCounterparty` in
 * this same file already returns for it. A provisional number would be a second numbering
 * scheme for the same document, which is the thing issuing exists to avoid.
 */
export function invoiceReference(invoice: Pick<InvoiceRecord, "number" | "id">): string {
  return invoice.number ?? "—";
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

/**
 * WHAT A NEW BILL IS DENOMINATED IN, AND WHETHER IT CAN BE WRITTEN AT ALL
 * (QA sweep run 6, QA6-17).
 *
 * The create form had `useState("EUR")` and a second `|| "EUR"` at the submit, so
 * an operator whose every event, deal, budget and settlement is SEK typed 2500 and
 * Postgres took `250000 | EUR`. It survived a hard reload, because the wrong
 * currency was never session state — it was the default.
 *
 * Here rather than in the component for the reason every money rule in this repo
 * is: the wrong answer does not throw, it stores a real number under a symbol
 * nobody chose. Two rules, and both of them refuse rather than guess:
 *
 *  - **An unknown code is not a currency.** `majorToMinor` asks `currencyExponent`,
 *    which throws — guessing an exponent is how ¥2,500 becomes ¥250,000.
 *  - **No currency at all is not EUR.** The KPI strip on the same screen already
 *    settled this in 2026-09-26's fix: *"zero in the wrong currency is a statement
 *    about their money that happens to be false"*. A bill is worse — it is stored.
 *
 * The amount is parsed by `majorToMinor` from the decimal STRING, never
 * `Number(amount) * 100`: that is a float multiplication on money, which
 * `docs/money.md` forbids, over a hard-coded exponent of 2.
 */
export interface InvoiceAmountDraft {
  /** The trimmed, upper-cased code — `""` when nothing has been typed or chosen. */
  code: string;
  /** Minor units, or null when there is no currency to interpret the amount in. */
  minor: bigint | null;
  /** Why this cannot be submitted, or null when it can. */
  problem: "no-currency" | "unknown-currency" | "no-amount" | null;
}

export function invoiceAmountDraft(amount: string, currency: string): InvoiceAmountDraft {
  const code = currency.trim().toUpperCase();
  if (code === "") return { code, minor: null, problem: "no-currency" };
  if (!isCurrencyCode(code)) return { code, minor: null, problem: "unknown-currency" };
  const minor = majorToMinor(amount.trim() || "0", code);
  // Zero and negative are both "no amount": a bill for nothing is not a bill, and a
  // negative one is a credit note, which this form does not write.
  return { code, minor, problem: minor > 0n ? null : "no-amount" };
}
