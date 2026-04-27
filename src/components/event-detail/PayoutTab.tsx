import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Users, X, Shield, Loader2, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, getStatusLabel, type Event, type Settlement, type TicketRevenue, type DealStructure } from "@/lib/models";

interface PayoutTabProps {
  event: Event;
  settlement: Settlement;
  buildPayoutRows: () => { label: string; value: number; color: string }[];
  deal?: DealStructure;
  revenue?: TicketRevenue;
}

export function PayoutTab({ event, settlement, buildPayoutRows, deal, revenue }: PayoutTabProps) {
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState("bank_transfer");
  const [processing, setProcessing] = useState(false);
  const [payoutSent, setPayoutSent] = useState(false);
  const [payoutMode, setPayoutMode] = useState<"all" | "individual" | null>(null);
  const [paidParties, setPaidParties] = useState<Record<string, boolean>>({});
  const [individualWarningAck, setIndividualWarningAck] = useState(false);
  const [payAllConfirm, setPayAllConfirm] = useState(false);
  const [selectedIndividualParty, setSelectedIndividualParty] = useState<string | null>(null);
  const payoutRef = `PO-${event.id}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const defaultParties = [
    { key: "artist", party: `Artist (${event.artist})`, amount: settlement.artistPayout, defaultIban: "NL91 ABNA 0417 1643 00" },
    { key: "promoter", party: `Promoter (${event.operator})`, amount: settlement.promoterPayout, defaultIban: "NL20 INGB 0001 2345 67" },
    { key: "venue", party: `Venue (${event.venue})`, amount: settlement.venuePayout, defaultIban: "NL86 RABO 0145 8372 81" },
    ...settlement.commissionPayouts.filter(c => c.payout > 0).map(c => ({ key: c.key, party: `${c.label} (${c.name})`, amount: c.payout, defaultIban: "NL44 RABO 0312 4567 89" })),
  ].filter(p => p.amount > 0);

  const [ibans, setIbans] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    defaultParties.forEach(p => { init[p.key] = p.defaultIban; });
    return init;
  });

  const totalPayout = defaultParties.reduce((s, p) => s + p.amount, 0);
  const estimatedArrival = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

  const allApprovalsConfirmed = settlement.approvals?.every(a => a.approved) ?? false;
  const somePaid = Object.values(paidParties).some(Boolean);
  const allPaid = defaultParties.length > 0 && defaultParties.every(p => paidParties[p.key]);

  const handleProcessPayout = () => {
    setProcessing(true);
    setTimeout(() => { setProcessing(false); setPayoutSent(true); }, 2000);
  };

  const handlePayIndividual = (partyKey: string) => {
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      setPaidParties(prev => ({ ...prev, [partyKey]: true }));
      setSelectedIndividualParty(null);
    }, 2000);
  };

  const isPayable = settlement.status === "finalized" || settlement.status === "partly_paid";

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-2">Payout</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {isPayable
            ? "Settlement is finalized. Choose how to process payouts below."
            : `Settlement is currently "${getStatusLabel(settlement.status)}". Finalize before processing payouts.`}
        </p>

        {isPayable && !payoutMode && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button onClick={() => setPayoutMode("all")} className="rounded-xl border-2 p-5 text-left transition-colors hover:border-primary">
              <CreditCard className="h-6 w-6 mb-2 text-primary" />
              <h4 className="font-display font-semibold">Pay All Parties</h4>
              <p className="mt-1 text-xs text-muted-foreground">Review and process all payouts at once</p>
            </button>
            <button onClick={() => setPayoutMode("individual")} className="rounded-xl border-2 p-5 text-left transition-colors hover:border-primary">
              <Users className="h-6 w-6 mb-2 text-primary" />
              <h4 className="font-display font-semibold">Pay Individually</h4>
              <p className="mt-1 text-xs text-muted-foreground">Pay each party separately at your own pace</p>
            </button>
          </div>
        )}

        {!isPayable && (
          <button disabled className="w-full rounded-xl border-2 p-5 text-left opacity-40 cursor-not-allowed">
            <CreditCard className="h-6 w-6 mb-2 text-primary" />
            <h4 className="font-display font-semibold">Process Payout</h4>
            <p className="mt-1 text-xs text-muted-foreground">Finalize the settlement first</p>
          </button>
        )}
      </div>

      {/* Pay All Mode */}
      {payoutMode === "all" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold">Pay All Parties</h3>
            <Button variant="ghost" size="sm" onClick={() => setPayoutMode(null)}>
              <X className="h-4 w-4 mr-1" /> Back
            </Button>
          </div>
          <div className="space-y-3">
            {defaultParties.map(({ key, party, amount }) => (
              <div key={key} className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                <p className="text-sm font-medium">{party}</p>
                <span className="font-display font-bold">{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-muted/30 px-4 py-3 flex justify-between">
            <span className="font-semibold">Total Payout</span>
            <span className="font-display font-bold text-lg">{formatCurrency(totalPayout)}</span>
          </div>
          <div className="flex items-start gap-2 pt-2">
            <Checkbox checked={payAllConfirm} onCheckedChange={(v) => setPayAllConfirm(!!v)} id="pay-all-confirm-detail" />
            <label htmlFor="pay-all-confirm-detail" className="text-sm text-muted-foreground cursor-pointer leading-tight">
              I have reviewed the settlement and confirm all payout amounts are correct
            </label>
          </div>
          <Button className="w-full" disabled={!payAllConfirm} onClick={() => setPayoutOpen(true)}>
            <CreditCard className="h-4 w-4 mr-2" /> Process All Payouts — {formatCurrency(totalPayout)}
          </Button>
        </div>
      )}

      {/* Individual Pay Mode */}
      {payoutMode === "individual" && (
        <div className="space-y-4">
          {!allApprovalsConfirmed && (
            <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Shield className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-destructive">Payment Risk Warning</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Not all sides of this event has reviewed and confirmed the settlement, paying one party before all sides confirmed could lead to payment disputes, refunds & financial disorder.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox checked={individualWarningAck} onCheckedChange={(v) => setIndividualWarningAck(!!v)} id="individual-warning-ack-detail" />
                <label htmlFor="individual-warning-ack-detail" className="text-sm text-muted-foreground cursor-pointer leading-tight">
                  I understand the risks and wish to proceed with individual payments
                </label>
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">Pay Individually</h3>
              <Button variant="ghost" size="sm" onClick={() => { setPayoutMode(null); setIndividualWarningAck(false); }}>
                <X className="h-4 w-4 mr-1" /> Back
              </Button>
            </div>
            <div className="space-y-3">
              {defaultParties.map(({ key, party, amount }) => {
                const isPaid = paidParties[key];
                const isProcessing = selectedIndividualParty === key && processing;
                return (
                  <div key={key} className={cn("rounded-lg px-4 py-3 space-y-2", isPaid ? "bg-[hsl(var(--success)/0.05)] border border-[hsl(var(--success)/0.2)]" : "bg-muted/50")}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{party}</p>
                        {isPaid && <Badge variant="outline" className="text-[10px] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]"><CheckCircle2 className="h-3 w-3 mr-1" /> Paid</Badge>}
                      </div>
                      <span className="font-display font-bold">{formatCurrency(amount)}</span>
                    </div>
                    {!isPaid && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Input value={ibans[key] || ""} onChange={e => setIbans(prev => ({ ...prev, [key]: e.target.value }))} className="font-mono text-xs h-8" placeholder="Enter IBAN" />
                        </div>
                        <Button size="sm" disabled={(!allApprovalsConfirmed && !individualWarningAck) || isProcessing} onClick={() => {
                          setSelectedIndividualParty(key);
                          handlePayIndividual(key);
                        }}>
                          {isProcessing ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Paying…</> : "Pay"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {somePaid && !allPaid && (
              <div className="rounded-lg bg-[hsl(var(--warning)/0.1)] border border-[hsl(var(--warning)/0.2)] px-4 py-3 text-sm">
                <span className="font-medium text-[hsl(var(--warning))]">Partly paid</span>
                <span className="text-muted-foreground ml-2">— {Object.values(paidParties).filter(Boolean).length} of {defaultParties.length} parties paid</span>
              </div>
            )}
            {allPaid && (
              <div className="rounded-lg bg-[hsl(var(--success)/0.1)] border border-[hsl(var(--success)/0.2)] p-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                <span className="text-sm font-medium text-[hsl(var(--success))]">All parties have been paid</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pay All Dialog */}
      <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Process Payout</DialogTitle>
            <DialogDescription>Review payout details and confirm</DialogDescription>
          </DialogHeader>
          {!payoutSent ? (
            <div className="space-y-5">
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Payout</p>
                <p className="text-3xl font-bold font-display">{formatCurrency(totalPayout)}</p>
                <p className="text-xs text-muted-foreground mt-1">{event.name} — {event.date}</p>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-2 block">Payment Method</Label>
                <RadioGroup value={payoutMethod} onValueChange={setPayoutMethod}>
                  {[
                    { value: "bank_transfer", label: "Bank Transfer (SEPA)", desc: "1-2 business days" },
                    { value: "ideal", label: "iDEAL", desc: "Instant" },
                    { value: "credit_card", label: "Credit Card", desc: "1-3 business days" },
                  ].map(m => (
                    <label key={m.value} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                      <RadioGroupItem value={m.value} />
                      <div><p className="text-sm font-medium">{m.label}</p><p className="text-xs text-muted-foreground">{m.desc}</p></div>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-2 block">Payout Breakdown</Label>
                <div className="space-y-2">
                  {defaultParties.map(p => (
                    <div key={p.key} className="flex justify-between text-sm rounded-lg bg-muted/30 px-3 py-2">
                      <span className="text-muted-foreground">{p.party}</span>
                      <span className="font-semibold">{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Estimated arrival:</span><span className="font-medium">{estimatedArrival}</span></div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPayoutOpen(false)}>Cancel</Button>
                <Button onClick={handleProcessPayout} disabled={processing}>
                  {processing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</> : "Process Payout"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-[hsl(var(--success)/0.1)] p-6 text-center">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-[hsl(var(--success))]" />
                <p className="font-semibold text-lg text-[hsl(var(--success))]">Payout Processed</p>
                <p className="text-xs text-muted-foreground mt-1 font-mono">Ref: {payoutRef}</p>
              </div>

              <div className="space-y-3">
                {[
                  { status: "Initiated", time: "Just now", active: true },
                  { status: "Processing", time: "In progress", active: true },
                  { status: "Completed", time: estimatedArrival, active: false },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={cn("h-3 w-3 rounded-full", step.active ? "bg-[hsl(var(--success))]" : "bg-muted-foreground/30")} />
                    <div className="flex-1"><p className="text-sm font-medium">{step.status}</p></div>
                    <span className="text-xs text-muted-foreground">{step.time}</span>
                  </div>
                ))}
              </div>

              <Button variant="outline" className="w-full" onClick={() => { setPayoutOpen(false); setPayoutSent(false); }}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
