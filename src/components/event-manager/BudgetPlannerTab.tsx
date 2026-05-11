import NumberInput from "@/components/NumberInput";
import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import BudgetCalculator from "@/components/BudgetCalculator";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { BarChart3, CheckCircle2 } from "lucide-react";
import {
  formatCurrency, getCurrencySymbol, type Event as AppEvent,
  type ProCode, type ProEventType, type ProEstimate, type ProConfidence,
  type TicketRevenue,
  proEventTypeLabels, calculateProFee,
} from "@/lib/models";
import { toast } from "@/hooks/use-toast";
import { fetchEventBudgetCalculator, saveEventBudgetCalculator, type EventMeta } from "@/lib/db";
import type { BudgetCalculatorPersisted } from "@/lib/budget-types";
import { queryKeys } from "@/lib/queries";

/* ─── Budget Planner Tab ─── */
export function BudgetPlannerTab({ canAccessBudget, event, revenue, eventMeta, currency = "EUR", onSave, childArtistFees, todoBudgetItems, budgetProfileChoices, budgetProfileId, onBudgetProfileIdChange }: {
  canAccessBudget: boolean;
  event: AppEvent;
  revenue: TicketRevenue | undefined;
  eventMeta: EventMeta;
  currency?: string;
  onSave?: (d: { proEstimate?: ProEstimate } | { budgetCalculator: BudgetCalculatorPersisted; budgetProfileId: string }) => void;
  childArtistFees?: { artist: string; fee: number }[];
  todoBudgetItems?: { id: string; name: string; type: "cost" | "revenue"; amount: number }[];
  budgetProfileChoices: { id: string; label: string }[];
  budgetProfileId: string;
  onBudgetProfileIdChange: (profileDocId: string) => void;
}) {
  const [proEstimate, setProEstimate] = useState<ProEstimate>(eventMeta.proEstimate || {
    pro: "none" as ProCode, country: "", eventType: "live_concert" as ProEventType,
    ticketPrice: 0, vatMode: "inclusive" as const, expectedTickets: 0, compTickets: 0,
    venueCapacity: event.capacity, estimatedFee: 0, manualOverride: false, manualValue: 0,
    confidence: "high" as ProConfidence, tariffVersion: "2026",
  });

  // Load initial budget calculator from subcollection
  const { data: initialBudget = null } = useQuery({
    queryKey: queryKeys.budgetCalculator(event.id, budgetProfileId),
    queryFn: () => fetchEventBudgetCalculator(event.id, budgetProfileId),
    enabled: !!budgetProfileId,
  });

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const budgetSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingBudgetSave = useRef<{ pid: string; payload: BudgetCalculatorPersisted } | null>(null);
  const lastSavedSig = useRef<string>(initialBudget ? JSON.stringify(initialBudget) : "");

  const flushPendingSave = () => {
    if (budgetSaveTimer.current) clearTimeout(budgetSaveTimer.current);
    if (pendingBudgetSave.current) {
      const { pid, payload } = pendingBudgetSave.current;
      pendingBudgetSave.current = null;
      lastSavedSig.current = JSON.stringify(payload);
      void saveEventBudgetCalculator(event.id, pid, payload).catch(() => {});
    }
  };

  // Flush pending save on unmount (tab switch, in-app navigation)
  useEffect(() => {
    return flushPendingSave;
  }, [event.id]);

  // Flush pending save on browser navigation (refresh, close tab)
  useEffect(() => {
    const onBeforeUnload = () => flushPendingSave();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [event.id]);

  useEffect(() => {
    if (!canAccessBudget) return;
    onSaveRef.current?.({ proEstimate });
  }, [canAccessBudget, proEstimate]);

  const proCalc = calculateProFee(proEstimate);

  if (!canAccessBudget) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-2">Budget planner</h3>
        <p className="text-sm text-muted-foreground">
          The budget planner is only visible to the event owner and to collaborators with planner or admin access on this event.
        </p>
      </div>
    );
  }

  // Scroll target for deal_updated (#deal) and revenue_updated (#revenue).
  // Both land on the budget tab; the calculator surfaces both, so a single
  // anchor on the tab root is the closest reasonable target.
  const tabRef = useScrollToHash<HTMLDivElement>("deal", "revenue");

  return (
    <div ref={tabRef} className="space-y-6 scroll-mt-24">
      <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Label className="text-sm font-medium">Planning view</Label>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Same visibility for everyone with budget access on this event. People who co-manage a business profile with you see the same numbers when that profile is selected; event admins can also open the event owner's planning views.
          </p>
        </div>
        {budgetProfileChoices.length > 1 ? (
          <Select
            value={budgetProfileId || budgetProfileChoices[0]?.id}
            onValueChange={(v) => {
              void onBudgetProfileIdChange(v);
            }}
          >
            <SelectTrigger className="w-full sm:w-[280px]">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent>
              {budgetProfileChoices.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground sm:text-right shrink-0">
            {budgetProfileChoices[0]?.label ?? "—"}
          </p>
        )}
      </div>
      <BudgetCalculator
        key={`${event.id}-${budgetProfileId || "default"}`}
        eventId={event.id}
        event={event}
        revenue={revenue}
        currency={currency}
        profileId={budgetProfileId || budgetProfileChoices[0]?.id || ""}
        initialPersisted={initialBudget}
        onBudgetChange={(payload) => {
          const pid = budgetProfileId || budgetProfileChoices[0]?.id || "";
          if (!pid) return;
          const sig = JSON.stringify(payload);
          if (sig === lastSavedSig.current) return;
          pendingBudgetSave.current = { pid, payload };
          if (budgetSaveTimer.current) clearTimeout(budgetSaveTimer.current);
          budgetSaveTimer.current = setTimeout(() => {
            pendingBudgetSave.current = null;
            lastSavedSig.current = sig;
            void saveEventBudgetCalculator(event.id, pid, payload).then(() => {
              toast({ title: (<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Budget planner saved</span>), duration: 1000 });
            }).catch(() => {
              toast({ title: "Failed to save budget", description: "Check your permissions or try again.", variant: "destructive" });
            });
          }, 2000);
        }}
        childArtistFees={childArtistFees}
        todoBudgetItems={todoBudgetItems}
      />

      {/* PRO Fee Estimator */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> PRO fee estimate
          </h3>
          <Badge variant="outline" className="text-xs font-normal">
            Estimate only
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Estimate only — approximate PRO costs for planning. Not a quote; final fees follow official tariffs.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>PRO</Label>
                <Select value={proEstimate.pro} onValueChange={(v) => setProEstimate(p => ({...p, pro: v as ProCode}))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="stim">STIM (Sweden)</SelectItem>
                    <SelectItem value="gema">GEMA (Germany)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Event Type</Label>
                <Select value={proEstimate.eventType} onValueChange={(v) => setProEstimate(p => ({...p, eventType: v as ProEventType}))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(proEventTypeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Ticket Price (avg)</Label><NumberInput value={proEstimate.ticketPrice || ""} onChange={(e) => setProEstimate(p => ({...p, ticketPrice: parseFloat(e.target.value) || 0}))} className="mt-1" placeholder={getCurrencySymbol(currency)} /></div>
              <div><Label>Expected Tickets</Label><NumberInput value={proEstimate.expectedTickets || ""} onChange={(e) => setProEstimate(p => ({...p, expectedTickets: parseInt(e.target.value) || 0}))} className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Comp. Tickets</Label><NumberInput value={proEstimate.compTickets || ""} onChange={(e) => setProEstimate(p => ({...p, compTickets: parseInt(e.target.value) || 0}))} className="mt-1" /></div>
              <div className="flex items-end gap-2">
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox checked={proEstimate.vatMode === "inclusive"} onCheckedChange={(c) => setProEstimate(p => ({...p, vatMode: c ? "inclusive" : "exclusive"}))} />
                  <span className="text-sm">Price incl. VAT</span>
                </div>
              </div>
            </div>
          </div>

          {/* Result */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Estimated PRO fee</span>
              <Badge variant="outline" className="text-xs font-normal">
                Estimate only
              </Badge>
            </div>
            <p className="text-2xl font-bold font-display">{formatCurrency(proEstimate.manualOverride ? proEstimate.manualValue : proCalc.fee, currency)}</p>
            <p className="text-xs text-muted-foreground">{proCalc.basis}</p>

            {proEstimate.pro === "gema" && (
              <p className="text-xs text-muted-foreground italic">Estimate only — GEMA tariffs vary by event type and classification.</p>
            )}

            <div className="flex items-center gap-3 pt-2 border-t">
              <Switch checked={proEstimate.manualOverride} onCheckedChange={(c) => setProEstimate(p => ({...p, manualOverride: c}))} />
              <span className="text-sm">Manual adjustment</span>
            </div>
            {proEstimate.manualOverride && (
              <div>
                <NumberInput value={proEstimate.manualValue || ""} onChange={(e) => setProEstimate(p => ({...p, manualValue: parseFloat(e.target.value) || 0}))} placeholder={`Custom PRO cost (${getCurrencySymbol(currency)})`} />
                <p className="text-xs text-muted-foreground mt-1">Estimate only — adjust using official STIM or GEMA pricing.</p>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">Estimate only. Final PRO fees depend on official tariffs.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
