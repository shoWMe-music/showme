import {
  type getApiV1ProfilesIdInvoices,
  useGetApiV1ProfilesIdInvoices,
  usePostApiV1Invoices,
  usePostApiV1InvoicesIidIssue,
} from "@showme/api-client";
import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Icon,
  Modal,
  SectionHeader,
  type Status,
  TextField,
  useToast,
} from "@showme/design-system";
import { type FormEvent, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { KpiRow, SegmentedToggle } from "../components";
import { ErrorState, LoadingState } from "../components/states";
import { errorMessage } from "../lib/errors";
import { formatDate, formatMoney } from "../lib/format";

type Invoice = Awaited<ReturnType<typeof getApiV1ProfilesIdInvoices>>[number];
type Direction = "issued" | "received";
/** The table tabs. "sent" = issued (receivable), "received" = payable,
 * "recurring" = repeating bills (not yet modelled — honest empty state). */
type Tab = "received" | "sent" | "recurring";

const TAB_DIRECTION: Record<Exclude<Tab, "recurring">, Direction> = {
  sent: "issued",
  received: "received",
};

/** First line-item label, if the jsonb payload carries one — a real descriptor
 * of what the invoice is for (there is no separate event-name field). */
function lineItemLabel(invoice: Invoice): string | null {
  const items = invoice.lineItems;
  if (Array.isArray(items) && items.length > 0) {
    const label = (items[0] as { label?: unknown })?.label;
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  return null;
}

/** Invoice document state → design-system status pill. */
const STATE_STATUS: Record<string, Status> = {
  draft: "draft",
  sent: "pending",
  issued: "pending",
  overdue: "cancelled",
  paid: "confirmed",
  void: "cancelled",
};

function stateLabel(state: string): string {
  return state.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

/** An invoice is "overdue" when it's unpaid and its due date has passed. */
function isOverdue(invoice: Invoice): boolean {
  if (invoice.state === "paid" || invoice.state === "void") return false;
  if (!invoice.dueDate) return false;
  const due = new Date(invoice.dueDate).getTime();
  return Number.isFinite(due) && due < Date.now();
}

function counterparty(invoice: Invoice): string {
  const ref = invoice.direction === "issued" ? invoice.recipientRef : invoice.issuerRef;
  return ref ?? "—";
}

export function Invoices() {
  const { session } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";
  const [tab, setTab] = useState<Tab>("received");
  const [creating, setCreating] = useState(false);

  const { data, isPending, isError, error, refetch } = useGetApiV1ProfilesIdInvoices(profileId, {
    query: { enabled: Boolean(profileId) },
  });

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
    let currency = "EUR";
    for (const invoice of invoices) {
      const amount = Number(invoice.total ?? 0);
      if (!Number.isFinite(amount)) continue;
      if (invoice.currency) currency = invoice.currency;
      const open = invoice.state !== "paid" && invoice.state !== "void";
      if (open && invoice.direction === "received") payable += amount;
      if (open && invoice.direction === "issued") receivable += amount;
      if (isOverdue(invoice)) overdue += amount;
    }
    return { payable, overdue, receivable, currency };
  }, [invoices]);

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
                value: formatMoney(kpis.payable, kpis.currency),
                hint: "Bills you owe",
                tone: "amber",
              },
              {
                label: "Overdue",
                value: formatMoney(kpis.overdue, kpis.currency),
                hint: "Past due date",
                tone: "red",
              },
              {
                label: "Receivable (sent)",
                value: formatMoney(kpis.receivable, kpis.currency),
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
            <LedgerTable rows={visible} onIssued={() => void refetch()} />
          )}
        </div>
      )}

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

function LedgerTable({ rows, onIssued }: { rows: Invoice[]; onIssued: () => void }) {
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

  const columns: DataTableColumn<Invoice>[] = [
    {
      header: "Vendor",
      width: "1.6fr",
      render: (invoice) => <b>{counterparty(invoice)}</b>,
    },
    {
      header: "Event / Reference",
      width: "1.6fr",
      render: (invoice) => {
        const reference = invoice.number ?? invoice.id.slice(0, 8);
        const label = lineItemLabel(invoice);
        return (
          <div>
            <div>{label ?? reference}</div>
            {label && (
              <div className="muted" style={{ fontSize: 12 }}>
                {reference}
              </div>
            )}
          </div>
        );
      },
    },
    {
      // No category field on the invoice payload yet — honest placeholder.
      header: "Category",
      width: "1fr",
      render: () => <span className="muted">—</span>,
    },
    {
      header: "Due",
      width: "1fr",
      render: (invoice) => formatDate(invoice.dueDate),
    },
    {
      header: "Amount",
      width: "1fr",
      align: "right",
      render: (invoice) => formatMoney(invoice.total, invoice.currency ?? "EUR"),
    },
    {
      header: "Status",
      width: "1fr",
      render: (invoice) => {
        const overdue = isOverdue(invoice);
        const state = overdue ? "overdue" : invoice.state;
        return (
          <Badge status={STATE_STATUS[state] ?? "draft"} dot>
            {overdue ? "Overdue" : stateLabel(invoice.state)}
          </Badge>
        );
      },
    },
    {
      header: "",
      width: "0.8fr",
      align: "right",
      render: (invoice) =>
        invoice.state === "draft" ? (
          <Button
            variant="ghost"
            onClick={() => issue.mutate({ iid: invoice.id })}
            disabled={issue.isPending}
          >
            Issue
          </Button>
        ) : null,
    },
  ];

  return (
    <Card padding="none">
      <DataTable columns={columns} rows={rows} getRowKey={(invoice) => invoice.id} />
    </Card>
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
  const [currency, setCurrency] = useState("EUR");
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

  // The API stores money as minor units (integer string).
  const minor = Math.round(Number(amount) * 100);
  const canSubmit = party.trim().length > 0 && Number.isFinite(minor) && minor > 0;

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!canSubmit) return;
    create.mutate({
      data: {
        ownerProfileId: profileId,
        direction,
        currency: currency.trim().toUpperCase() || "EUR",
        total: String(minor),
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
            onChange={(changeEvent) => setCurrency(changeEvent.target.value)}
          />
        </div>
        <TextField
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
