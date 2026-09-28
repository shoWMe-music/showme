import {
  type getApiV1ProfilesIdInvoices,
  useGetApiV1Me,
  useGetApiV1Profiles,
  useGetApiV1ProfilesIdInvoices,
  usePostApiV1Invoices,
  usePostApiV1InvoicesIidIssue,
} from "@showme/api-client";
import {
  Button,
  EmptyState,
  Icon,
  Modal,
  SectionHeader,
  TextField,
  useToast,
} from "@showme/design-system";
import { currencyForCountry } from "@showme/shared";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { KpiRow, SegmentedToggle } from "../components";
import { DateTimeField } from "../components/DateTimeField";
import { InvoiceDetailModal } from "../components/InvoiceDetailModal";
import { InvoiceLedgerTable } from "../components/InvoiceLedgerTable";
import {
  countsAsMoneyOwed,
  invoiceAmountDraft,
  isInvoiceOverdue,
} from "../components/invoiceDocument";
import { ErrorState, LoadingState } from "../components/states";
import { errorMessage } from "../lib/errors";
import { formatAmount, formatMoney } from "../lib/format";

type Invoice = Awaited<ReturnType<typeof getApiV1ProfilesIdInvoices>>[number];
type Direction = "issued" | "received";
/** The table tabs. "sent" = issued (receivable), "received" = payable,
 * "recurring" = repeating bills (not yet modelled — honest empty state). */
type Tab = "received" | "sent" | "recurring";

const TAB_DIRECTION: Record<Exclude<Tab, "recurring">, Direction> = {
  sent: "issued",
  received: "received",
};

export function Invoices() {
  const { session } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";
  const [tab, setTab] = useState<Tab>("received");
  const [creating, setCreating] = useState(false);
  /** The invoice whose document is open over the ledger; null = overlay closed. */
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const { data, isPending, isError, error, refetch } = useGetApiV1ProfilesIdInvoices(profileId, {
    query: { enabled: Boolean(profileId) },
  });
  /**
   * Two sources for the currency behind an EMPTY ledger's zeros — see `money` below.
   * The profile's own country is the authoritative one (`decisions.md` #17); the
   * account's chosen currency is the reader's own stated preference, and the New
   * invoice dialog in this same file already treats it as exactly that.
   */
  const profilesQuery = useGetApiV1Profiles();
  const homeCountry =
    profilesQuery.data?.find((profile) => profile.id === profileId)?.location?.country ?? null;
  const accountCurrency = useGetApiV1Me().data?.currency ?? null;

  // `GET /profiles/:id/invoices` returns the profile's whole ledger — no cursor,
  // no query parameters — so the tabs and the KPIs below are over all of it.
  const invoices = data ?? [];
  const visible =
    tab === "recurring"
      ? []
      : invoices.filter((invoice) => invoice.direction === TAB_DIRECTION[tab]);

  // KPIs summarise the whole ledger (not the active tab), matching the prototype.
  const kpis = useMemo(() => {
    let payable = 0;
    let overdue = 0;
    let receivable = 0;
    /**
     * NO INVOICES MEANS NO CURRENCY TO NAME — not EUR.
     *
     * The fallback was `"EUR"`, so a performer whose events, deals and settlements are
     * all SEK opened this screen and read `OUTSTANDING (PAYABLE) €0 · OVERDUE €0 ·
     * RECEIVABLE (SENT) €0`, while their own Settlements screen read SEK throughout
     * (measured 2026-09-26). Zero in the wrong currency is a statement about their
     * money that happens to be false.
     *
     * `formatAmount` exists for precisely this and says so in its own comment —
     * showing a number under the wrong symbol is worse than showing it under none.
     */
    let currency: string | null = null;
    for (const invoice of invoices) {
      const amount = Number(invoice.total ?? 0);
      if (!Number.isFinite(amount)) continue;
      if (invoice.currency) currency = invoice.currency;
      // A draft is in neither total: see `countsAsMoneyOwed` (QA7-13). The row still
      // shows in the table below — it is money that has not started moving, not money
      // that does not exist.
      const moving = countsAsMoneyOwed(invoice);
      if (moving && invoice.direction === "received") payable += amount;
      if (moving && invoice.direction === "issued") receivable += amount;
      if (isInvoiceOverdue(invoice)) overdue += amount;
    }
    return { payable, overdue, receivable, currency };
  }, [invoices]);
  /**
   * THE LEDGER'S OWN CURRENCY — AND ONLY ON AN EMPTY LEDGER, THE READER'S (QA7-19).
   *
   * A performer with no invoices read a bare `0` in all three tiles: the only number
   * a new account ever sees on this screen, and the one without units. The currency
   * came from the rows, and there were none.
   *
   * The fallbacks are gated on `invoices.length === 0`, and the gate is the whole
   * safety argument. On an empty ledger every figure here is exactly zero, so naming
   * it in the reader's own currency is cosmetic by construction. The moment a single
   * row exists, the rows decide — a ledger whose invoices carry no currency keeps the
   * unadorned figure, because those totals are real money and labelling real money
   * with a preference is the run-3 defect (an all-SEK performer reading `€0`) in the
   * other direction.
   *
   * `currencyForCountry`, NOT `defaultCurrencyForCountry`: the latter falls back to
   * EUR, which is the guess that produced that defect. Nothing known, no symbol.
   */
  const money = (amount: number) => {
    const reader =
      invoices.length === 0 ? (currencyForCountry(homeCountry) ?? accountCurrency) : null;
    const denomination = kpis.currency ?? reader;
    return denomination ? formatMoney(amount, denomination) : formatAmount(amount);
  };

  return (
    <>
      <SectionHeader
        eyebrow="Finance"
        title="Bills & Invoices"
        subtitle="Track what you owe, what you're owed, and recurring costs."
        actions={
          <Button
            variant="primary"
            leftIcon={<Icon name="plus" />}
            onClick={() => setCreating(true)}
            disabled={!profileId}
          >
            New invoice
          </Button>
        }
      />

      {!profileId ? (
        <EmptyState icon={<Icon name="receipt" />} title="No profile selected" />
      ) : isPending ? (
        <LoadingState label="Loading invoices" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load invoices" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <KpiRow
            items={[
              {
                label: "Outstanding (payable)",
                value: money(kpis.payable),
                hint: "Bills you owe",
                tone: "amber",
              },
              {
                label: "Overdue",
                value: money(kpis.overdue),
                hint: "Past due date",
                tone: "red",
              },
              {
                label: "Receivable (sent)",
                value: money(kpis.receivable),
                hint: "Invoices you've issued",
              },
              {
                // No recurring-invoice flag on the payload yet — shown honestly.
                label: "Recurring / mo",
                value: "—",
                hint: "Not tracked yet",
              },
            ]}
          />

          <SegmentedToggle<Tab>
            aria-label="Invoice view"
            value={tab}
            onChange={setTab}
            options={[
              { value: "received", label: "Received" },
              { value: "sent", label: "Sent" },
              { value: "recurring", label: "Recurring" },
            ]}
          />

          {tab === "recurring" ? (
            <EmptyState
              icon={<Icon name="receipt" />}
              title="No recurring invoices"
              description="Repeating bills — rent, subscriptions, retainers — aren't tracked yet. When they are, they'll appear here."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Icon name="receipt" />}
              title={tab === "sent" ? "No invoices sent" : "No bills received"}
              description={
                tab === "sent"
                  ? "Invoices you raise for venue rental, fees and services appear here."
                  : "Bills you owe — crew, production, ticketing — appear here."
              }
              action={
                <Button
                  variant="primary"
                  leftIcon={<Icon name="plus" />}
                  onClick={() => setCreating(true)}
                >
                  New invoice
                </Button>
              }
            />
          ) : (
            <LedgerTable
              rows={visible}
              // "recurring" renders its own empty state above and never reaches here.
              direction={TAB_DIRECTION[tab as Exclude<Tab, "recurring">]}
              onOpenInvoice={setOpenInvoiceId}
              onIssued={() => void refetch()}
            />
          )}
        </div>
      )}

      <InvoiceDetailModal invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} />

      <NewInvoiceModal
        open={creating}
        profileId={profileId}
        initialDirection={tab === "sent" ? "issued" : "received"}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void refetch();
        }}
      />
    </>
  );
}

/** Container for the ledger: owns the issue mutation and the toast; the table
 * itself is presentational. */
function LedgerTable({
  rows,
  direction,
  onOpenInvoice,
  onIssued,
}: {
  rows: Invoice[];
  direction: Direction;
  onOpenInvoice: (invoiceId: string) => void;
  onIssued: () => void;
}) {
  const toast = useToast();
  const issue = usePostApiV1InvoicesIidIssue({
    mutation: {
      onSuccess: () => {
        toast.success("Invoice issued");
        onIssued();
      },
      onError: (mutationError) => toast.error(errorMessage(mutationError, "Couldn't issue.")),
    },
  });

  return (
    <InvoiceLedgerTable
      rows={rows}
      direction={direction}
      onOpenInvoice={onOpenInvoice}
      onIssueInvoice={(invoiceId) => issue.mutate({ iid: invoiceId })}
      isIssuing={issue.isPending}
    />
  );
}

function NewInvoiceModal({
  open,
  profileId,
  initialDirection,
  onClose,
  onCreated,
}: {
  open: boolean;
  profileId: string;
  initialDirection: Direction;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [party, setParty] = useState("");
  const [amount, setAmount] = useState("");
  /**
   * THE ACCOUNT'S OWN CURRENCY, NEVER EUR — the same lesson this file already
   * learned 190 lines above, at a surface that only DISPLAYED the wrong symbol
   * (QA sweep run 6, QA6-17).
   *
   * This one stores it. The field was `useState("EUR")` with a second `|| "EUR"`
   * at the submit, so an operator whose every event, deal, budget and settlement
   * is SEK typed 2500 into a form pre-filled EUR and Postgres took
   * `250000 | EUR` — a bill for €2,500 that nobody wrote. It survived a hard
   * reload, because it was never session state.
   *
   * `GET /me` carries the account's chosen currency (the **Account currency** row in
   * Settings → General writes it — called "Base currency" until QA9-10, which is the
   * name of the AUTHORITATIVE measure and was never what this field is). Null means UNCHOSEN, and the KPI comment above
   * settles what to do about that: name no currency rather than the wrong one. So
   * an account with no currency cannot submit this form, and the field says why —
   * refusing is the honest answer, and inventing EUR is what produced the defect.
   */
  const me = useGetApiV1Me();
  const accountCurrency = me.data?.currency ?? null;
  const [currency, setCurrency] = useState("");
  const [currencyTouched, setCurrencyTouched] = useState(false);
  // Seeded when `GET /me` lands, and never over a currency the user has typed —
  // the same shape Settings uses for these two fields, and for the same reason:
  // the value arrives after the first render.
  useEffect(() => {
    if (currencyTouched) return;
    setCurrency(accountCurrency ?? "");
  }, [accountCurrency, currencyTouched]);
  const [dueDate, setDueDate] = useState("");

  const create = usePostApiV1Invoices({
    mutation: {
      onSuccess: () => {
        toast.success("Invoice created");
        onCreated();
        setParty("");
        setAmount("");
        setDueDate("");
      },
      onError: (mutationError) =>
        toast.error(errorMessage(mutationError, "Couldn't create the invoice.")),
    },
  });

  // The currency rule and the minor-unit parse both live in `invoiceAmountDraft`,
  // which refuses rather than guessing — see its comment for why either guess is
  // the defect this replaces.
  const draft = invoiceAmountDraft(amount, currency);
  const canSubmit = party.trim().length > 0 && draft.problem === null;

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!canSubmit) return;
    create.mutate({
      data: {
        ownerProfileId: profileId,
        direction,
        currency: draft.code,
        total: (draft.minor ?? 0n).toString(),
        ...(direction === "issued" ? { recipientRef: party.trim() } : { issuerRef: party.trim() }),
        ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New invoice"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit || create.isPending}
            leftIcon={<Icon name="plus" />}
          >
            {create.isPending ? "Creating…" : "Create invoice"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <SegmentedToggle<Direction>
          aria-label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "issued", label: "Issued (receivable)" },
            { value: "received", label: "Received (payable)" },
          ]}
        />
        <TextField
          label={direction === "issued" ? "Bill to" : "From"}
          value={party}
          placeholder="Counterparty name"
          onChange={(changeEvent) => setParty(changeEvent.target.value)}
          autoFocus
        />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
          <TextField
            label="Amount"
            type="number"
            value={amount}
            placeholder="0.00"
            onChange={(changeEvent) => setAmount(changeEvent.target.value)}
          />
          <TextField
            label="Currency"
            value={currency}
            maxLength={3}
            placeholder={accountCurrency ?? "SEK"}
            // Said out loud rather than defaulted: an account that has never
            // chosen a base currency has no currency to put on a bill, and the
            // one thing this form must not do is pick one for them.
            hint={
              draft.problem === "unknown-currency"
                ? `${draft.code} isn't a currency we know.`
                : draft.problem === "no-currency" && accountCurrency === null
                  ? "Set your account currency in Settings → General, or type the one this bill is in."
                  : undefined
            }
            onChange={(changeEvent) => {
              setCurrencyTouched(true);
              setCurrency(changeEvent.target.value);
            }}
          />
        </div>
        <DateTimeField
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(changeEvent) => setDueDate(changeEvent.target.value)}
        />
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
  );
}
