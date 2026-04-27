import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useUser } from "@/lib/user-context";
import { formatCurrency } from "@/lib/models";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, Eye, ArrowUpRight, ArrowDownLeft, RefreshCw, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type TransactionStatus = "completed" | "pending" | "failed";
type PaymentMethod = "iDEAL" | "Credit Card" | "SEPA Direct Debit" | "Bank Transfer" | "Bancontact";
type TabType = "received" | "sent" | "recurring";

interface Transaction {
  id: string;
  transactionId: string;
  date: string;
  counterparty: string;
  description: string;
  amount: number;
  method: PaymentMethod;
  status: TransactionStatus;
  eventName?: string;
  lineItems: { description: string; quantity: number; unitPrice: number }[];
  tax: number;
}

const STATUS_STYLES: Record<TransactionStatus, string> = {
  completed: "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]",
  pending: "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]",
  failed: "bg-destructive/10 text-destructive",
};

const METHOD_ICONS: Record<PaymentMethod, string> = {
  "iDEAL": "🏦",
  "Credit Card": "💳",
  "SEPA Direct Debit": "🏛️",
  "Bank Transfer": "🔄",
  "Bancontact": "🇧🇪",
};

export default function BillsInvoicesPage() {
  const { currentUser } = useUser();
  const [activeTab, setActiveTab] = useState<TabType>("received");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);

  const currency = currentUser.currency || "EUR";
  const fc = (v: number) => formatCurrency(v, currency);

  const allData: Record<TabType, Transaction[]> = { received: [], sent: [], recurring: [] };
  const tabItems = allData[activeTab];

  const filtered = tabItems.filter(tx => {
    if (statusFilter !== "all" && tx.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return tx.transactionId.toLowerCase().includes(q) || tx.counterparty.toLowerCase().includes(q) || tx.description.toLowerCase().includes(q);
    }
    return true;
  });

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: "received", label: "Payments Received", icon: <ArrowDownLeft className="h-3.5 w-3.5" /> },
    { id: "sent", label: "Payments Sent", icon: <ArrowUpRight className="h-3.5 w-3.5" /> },
    { id: "recurring", label: "Recurring", icon: <RefreshCw className="h-3.5 w-3.5" /> },
  ];

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return d; }
  };

  const handleExportCSV = () => {
    const rows = [["Transaction ID", "Date", "Counterparty", "Description", "Amount", "Method", "Status"]];
    filtered.forEach(tx => rows.push([tx.transactionId, formatDate(tx.date), tx.counterparty, tx.description, tx.amount.toFixed(2), tx.method, tx.status]));
    const blob = new Blob([rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `transactions-${activeTab}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (detailTx) {
    const subtotal = detailTx.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
    return (
      <AppLayout>
        <div className="animate-fade-in max-w-3xl">
          <button onClick={() => setDetailTx(null)} className="mb-4 text-sm text-muted-foreground hover:text-foreground transition-colors">← Back to {tabs.find(t => t.id === activeTab)?.label}</button>
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{detailTx.transactionId}</h1>
              <p className="text-muted-foreground">{detailTx.counterparty}</p>
            </div>
            <Badge className={cn("text-xs", STATUS_STYLES[detailTx.status])}>{detailTx.status}</Badge>
          </div>
          <div className="rounded-xl border bg-card p-8 shadow-sm">
            <div className="flex justify-between mb-8">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Transaction</p>
                <p className="text-lg font-bold font-mono">{detailTx.transactionId}</p>
              </div>
              <div className="text-right text-sm">
                <p><span className="text-muted-foreground">Date:</span> {formatDate(detailTx.date)}</p>
                <p><span className="text-muted-foreground">Method:</span> {METHOD_ICONS[detailTx.method]} {detailTx.method}</p>
                {detailTx.eventName && <p><span className="text-muted-foreground">Event:</span> {detailTx.eventName}</p>}
              </div>
            </div>
            <div className="mb-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">{activeTab === "received" ? "From" : "To"}</p>
              <p className="font-medium">{detailTx.counterparty}</p>
            </div>
            <table className="w-full mb-6">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="text-left py-2">Description</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-right py-2">Unit Price</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detailTx.lineItems.map((li, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-3 text-sm">{li.description}</td>
                    <td className="py-3 text-sm text-right">{li.quantity}</td>
                    <td className="py-3 text-sm text-right">{fc(li.unitPrice)}</td>
                    <td className="py-3 text-sm text-right font-medium">{fc(li.quantity * li.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{fc(subtotal)}</span></div>
                {detailTx.tax > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">VAT (21%)</span><span>{fc(detailTx.tax)}</span></div>}
                <div className="flex justify-between text-sm font-bold border-t pt-2"><span>Total</span><span>{fc(detailTx.amount)}</span></div>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="gap-2" onClick={() => {
              const rows = [[detailTx.transactionId], [`Date,${formatDate(detailTx.date)}`], [`Method,${detailTx.method}`], [`Counterparty,${detailTx.counterparty}`], [""], ["Description,Qty,Unit Price,Amount"],
                ...detailTx.lineItems.map(li => `"${li.description}",${li.quantity},${fc(li.unitPrice)},${fc(li.quantity * li.unitPrice)}`),
                "", `Subtotal,${fc(subtotal)}`, detailTx.tax > 0 ? `VAT,${fc(detailTx.tax)}` : "", `Total,${fc(detailTx.amount)}`].filter(Boolean);
              const blob = new Blob([Array.isArray(rows) ? rows.join("\n") : ""], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `${detailTx.transactionId}.csv`; a.click();
              URL.revokeObjectURL(url);
            }}><Download className="h-4 w-4" /> Download Receipt</Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Recurring tab - subscription only
  if (activeTab === "recurring") {
    return (
      <AppLayout>
        <div className="animate-fade-in">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Bills & Invoices</h1>
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                <p className="text-sm">Invoices and receipts are automatically generated by our payment provider</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-1 border-b">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn("flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                  activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >{tab.icon}{tab.label}</button>
            ))}
          </div>

          {/* Subscription card */}
          <div className="max-w-xl">
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <RefreshCw className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">shoWMe Professional</h3>
                    <p className="text-sm text-muted-foreground">Monthly subscription</p>
                  </div>
                </div>
                <Badge className={cn("text-xs", STATUS_STYLES["completed"])}>Active</Badge>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <span className="text-lg font-bold font-display">{fc(199)}/month</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Payment method</span>
                  <span className="text-sm flex items-center gap-1.5">🏛️ SEPA Direct Debit</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Next billing date</span>
                  <span className="text-sm font-medium">1 Apr 2026</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Started</span>
                  <span className="text-sm font-medium">1 Jan 2026</span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t">
                <p className="text-xs text-muted-foreground mb-3">Recent payments</p>
                <div className="space-y-2">
                  {["Mar", "Feb", "Jan"].map((month) => (
                    <div key={month} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))]" />
                        <span className="text-muted-foreground">1 {month} 2026</span>
                      </div>
                      <span className="font-medium">{fc(199)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Bills & Invoices</h1>
            <div className="mt-1 flex items-center gap-2 text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              <p className="text-sm">Invoices and receipts are automatically generated by our payment provider</p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={handleExportCSV}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn("flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >{tab.icon}{tab.label}</button>
          ))}
        </div>

        {/* Filters */}
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search transactions..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Total Completed", value: fc(tabItems.filter(t => t.status === "completed").reduce((s, t) => s + t.amount, 0)), color: "text-[hsl(var(--success))]" },
            { label: "Pending", value: fc(tabItems.filter(t => t.status === "pending").reduce((s, t) => s + t.amount, 0)), color: "text-[hsl(var(--warning))]" },
            { label: "Failed", value: fc(tabItems.filter(t => t.status === "failed").reduce((s, t) => s + t.amount, 0)), color: "text-destructive" },
          ].map(card => (
            <div key={card.label} className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className={cn("text-lg font-bold font-display mt-1", card.color)}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transaction ID</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Counterparty</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Method</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">No transactions found</td></tr>
              )}
              {filtered.map(tx => (
                <tr key={tx.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setDetailTx(tx)}>
                  <td className="px-6 py-4"><span className="font-mono text-xs font-medium">{tx.transactionId}</span></td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{formatDate(tx.date)}</td>
                  <td className="px-6 py-4 text-sm">{tx.counterparty}</td>
                  <td className="px-6 py-4 text-sm"><span className="flex items-center gap-1.5">{METHOD_ICONS[tx.method]} {tx.method}</span></td>
                  <td className="px-6 py-4 text-sm font-semibold font-display text-right">{fc(tx.amount)}</td>
                  <td className="px-6 py-4"><Badge className={cn("text-xs", STATUS_STYLES[tx.status])}>{tx.status}</Badge></td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setDetailTx(tx); }}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
