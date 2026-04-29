import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from "react";
import { formatCurrency, calculateProFee, type Event as AppEvent, type TicketRevenue, type TicketType, type ProEstimate, type ProCode } from "@/lib/models";
import {
  type BudgetField, type BudgetTemplate, type BudgetCalculatorPersisted,
  getDefaultRevenueFields, getDefaultCostFields, getDefaultResultFields,
  evaluateFormula,
} from "@/lib/budget-types";

export type LocalTicketRow = { id: string; name: string; price: number; expectedSold: number };
export type TicketRevenueRow =
  | { key: string; name: string; price: number; expectedSold: number; revenue: number; isLocal: false }
  | { key: string; name: string; price: number; expectedSold: number; revenue: number; isLocal: true; localId: string };

interface UseBudgetCalculatorProps {
  event: AppEvent;
  revenue?: TicketRevenue;
  currency?: string;
  initialPersisted?: BudgetCalculatorPersisted | null;
  onBudgetChange?: (data: BudgetCalculatorPersisted) => void;
  childArtistFees?: { artist: string; fee: number }[];
  todoBudgetItems?: { id: string; name: string; type: "cost" | "revenue"; amount: number }[];
}

export function useBudgetCalculator({
  event,
  revenue,
  currency = "EUR",
  initialPersisted,
  onBudgetChange,
  childArtistFees,
  todoBudgetItems,
}: UseBudgetCalculatorProps) {
  const isDraft = event.eventStatus === "draft";

  const [revenueFields, setRevenueFields] = useState<BudgetField[]>(() => {
    const fields = getDefaultRevenueFields();
    if (!isDraft) fields.find(f => f.id === "capacity")!.value = event.capacity ?? 0;
    return fields;
  });
  const [costFields, setCostFields] = useState<BudgetField[]>(() => {
    const defaults = getDefaultCostFields();
    if (childArtistFees && childArtistFees.length > 0) {
      const withoutGeneric = defaults.filter(f => f.id !== "artist_fee");
      const artistFields: BudgetField[] = childArtistFees.map((af, i) => ({
        id: `artist_fee_${i}`,
        name: childArtistFees.length === 1 ? "Performer fee" : `Performer fee — ${af.artist}`,
        category: "cost" as const,
        type: "manual" as const, value: af.fee, isDefault: false, removable: false, readOnly: true, order: i,
      }));
      const reordered = withoutGeneric.map(f => ({ ...f, order: f.order + artistFields.length }));
      return [...artistFields, ...reordered];
    }
    return defaults;
  });
  const [resultFields, setResultFields] = useState<BudgetField[]>(getDefaultResultFields);
  const [manualOverrides, setManualOverrides] = useState<Record<string, number>>({});
  const [localTicketTypes, setLocalTicketTypes] = useState<LocalTicketRow[]>([]);
  const [ticketExpectedSold, setTicketExpectedSold] = useState<Record<string, number>>({});

  const onBudgetChangeRef = useRef(onBudgetChange);
  onBudgetChangeRef.current = onBudgetChange;
  const lastHydratedJson = useRef<string>("");
  const localTicketIdRef = useRef(0);

  useLayoutEffect(() => {
    const b = initialPersisted;
    if (!b?.revenueFields?.length) return;
    const sig = JSON.stringify(b);
    if (sig === lastHydratedJson.current) return;
    lastHydratedJson.current = sig;
    setRevenueFields(b.revenueFields);
    setCostFields(b.costFields?.length ? b.costFields : getDefaultCostFields());
    setResultFields(b.resultFields?.length ? b.resultFields : getDefaultResultFields());
    setManualOverrides(b.manualOverrides ?? {});
    setLocalTicketTypes(b.localTicketTypes ?? []);
    setTicketExpectedSold(b.ticketExpectedSold ?? {});
  }, [initialPersisted]);

  useEffect(() => {
    if (!todoBudgetItems) return;
    const todoCosts = todoBudgetItems.filter(t => t.type === "cost").map((t, i) => ({
      id: `todo_${t.id}`, name: `📋 ${t.name}`, category: "cost" as const, type: "manual" as const,
      value: t.amount, isDefault: false, removable: false, readOnly: true, order: 900 + i,
    }));
    setCostFields(prev => [...prev.filter(f => !f.id.startsWith("todo_")), ...todoCosts]);
    const todoRevenue = todoBudgetItems.filter(t => t.type === "revenue").map((t, i) => ({
      id: `todo_${t.id}`, name: `📋 ${t.name}`, category: "revenue" as const, type: "manual" as const,
      value: t.amount, isDefault: false, removable: false, readOnly: true, order: 900 + i,
    }));
    setRevenueFields(prev => [...prev.filter(f => !f.id.startsWith("todo_")), ...todoRevenue]);
  }, [todoBudgetItems]);

  // Keep performer-fee cost rows in sync with the deal-driven childArtistFees prop.
  // Without this, persisted budgets ignore deal updates because hydration overwrites state.
  useEffect(() => {
    if (!childArtistFees || childArtistFees.length === 0) return;
    const artistFields: BudgetField[] = childArtistFees.map((af, i) => ({
      id: `artist_fee_${i}`,
      name: childArtistFees.length === 1 ? "Performer fee" : `Performer fee — ${af.artist}`,
      category: "cost" as const,
      type: "manual" as const,
      value: af.fee,
      isDefault: false,
      removable: false,
      readOnly: true,
      order: i,
    }));
    setCostFields(prev => {
      const withoutArtist = prev.filter(f => f.id !== "artist_fee" && !f.id.startsWith("artist_fee_"));
      return [...artistFields, ...withoutArtist];
    });
  }, [childArtistFees]);

  const externalTicketTypes: TicketType[] = revenue?.ticketTypes ?? [];

  useEffect(() => {
    if (externalTicketTypes.length > 0) {
      setTicketExpectedSold(prev => {
        const next = { ...prev };
        externalTicketTypes.forEach(tt => {
          const key = `tt_${tt.name}`;
          if (next[key] === undefined) next[key] = tt.sold || 0;
        });
        return next;
      });
    }
  }, [externalTicketTypes.length]);

  const ticketRevenueItems = useMemo((): TicketRevenueRow[] => {
    const fromExternal: TicketRevenueRow[] = externalTicketTypes.map(tt => {
      const key = `tt_${tt.name}`;
      const expectedSold = ticketExpectedSold[key] ?? tt.sold ?? 0;
      return { name: tt.name, price: tt.price, expectedSold, revenue: tt.price * expectedSold, key, isLocal: false };
    });
    const fromLocal: TicketRevenueRow[] = localTicketTypes.map(tt => ({
      name: tt.name, price: tt.price, expectedSold: tt.expectedSold,
      revenue: tt.price * tt.expectedSold, key: tt.id, isLocal: true, localId: tt.id,
    }));
    return [...fromExternal, ...fromLocal];
  }, [externalTicketTypes, ticketExpectedSold, localTicketTypes]);

  const totalTicketRevenue = ticketRevenueItems.reduce((s, t) => s + t.revenue, 0);
  const totalExpectedTickets = ticketRevenueItems.reduce((s, t) => s + t.expectedSold, 0);
  const weightedAvgPrice = totalExpectedTickets > 0 ? totalTicketRevenue / totalExpectedTickets : 0;

  const allFields = useMemo(() => {
    const virtualFields: BudgetField[] = [
      { id: "ticket_revenue", name: "Ticket revenue", category: "revenue", type: "calculated", value: totalTicketRevenue, order: -3 },
      { id: "total_expected_tickets", name: "Total expected tickets", category: "revenue", type: "calculated", value: totalExpectedTickets, order: -2 },
      { id: "ticket_price", name: "Avg ticket price", category: "revenue", type: "calculated", value: weightedAvgPrice, order: -1 },
    ];
    return [...virtualFields, ...revenueFields, ...costFields, ...resultFields];
  }, [revenueFields, costFields, resultFields, totalTicketRevenue, totalExpectedTickets, weightedAvgPrice]);

  const getFieldValue = useCallback((id: string): number => {
    if (id === "ticket_revenue") return totalTicketRevenue;
    if (id === "total_expected_tickets" || id === "expected_tickets") return totalExpectedTickets;
    if (id === "ticket_price") return weightedAvgPrice;
    return allFields.find(f => f.id === id)?.value ?? 0;
  }, [allFields, totalTicketRevenue, totalExpectedTickets, weightedAvgPrice]);

  const getFieldName = useCallback((id: string): string => {
    return allFields.find(f => f.id === id)?.name ?? id;
  }, [allFields]);

  useEffect(() => {
    let changed = false;
    const newRevenue = revenueFields.map(f => {
      if (f.type === "calculated" && f.formula) {
        const val = evaluateFormula(f.formula, getFieldValue);
        if (Math.abs(val - f.value) > 0.001) { changed = true; return { ...f, value: val }; }
      }
      return f;
    });
    const newCosts = costFields.map(f => {
      if (f.id === "payment_fees") {
        const pct = f.config?.paymentFeePercent ?? 2.9;
        const fixed = f.config?.paymentFeeFixed ?? 0;
        const val = (totalTicketRevenue * pct / 100) + (fixed * totalExpectedTickets);
        if (Math.abs(val - f.value) > 0.001) { changed = true; return { ...f, value: val }; }
      } else if (f.id === "pro_cost") {
        const proType = f.config?.proType ?? "none";
        let val = 0;
        if (proType === "custom_percent") {
          val = totalTicketRevenue * (f.config?.proCustomPercent ?? 5) / 100;
        } else if (proType !== "none") {
          const estimate: ProEstimate = {
            pro: proType as ProCode, country: proType === "stim" ? "Sweden" : "Germany",
            eventType: "live_concert", ticketPrice: weightedAvgPrice,
            vatMode: "inclusive", expectedTickets: totalExpectedTickets,
            compTickets: 0, venueCapacity: event.capacity ?? 0,
            estimatedFee: 0, manualOverride: false, manualValue: 0,
            confidence: "high", tariffVersion: "2026",
          };
          val = calculateProFee(estimate).fee;
        }
        if (Math.abs(val - f.value) > 0.001) { changed = true; return { ...f, value: val }; }
      } else if (f.type === "calculated" && f.formula) {
        const val = evaluateFormula(f.formula, getFieldValue);
        if (Math.abs(val - f.value) > 0.001) { changed = true; return { ...f, value: val }; }
      }
      return f;
    });
    const revenueTotal = newRevenue.filter(f => !["capacity", "avg_bar_spend", "total_expected_tickets"].includes(f.id) && !f.id.startsWith("tt_expected_")).reduce((s, f) => s + f.value, 0) + totalTicketRevenue;
    const costsTotal = newCosts.reduce((s, f) => s + f.value, 0);
    const profitLoss = revenueTotal - costsTotal;
    const barRevenue = newRevenue.find(f => f.id === "bar_revenue")?.value ?? 0;
    const otherRevenue = newRevenue.find(f => f.id === "other_revenue")?.value ?? 0;
    const breakeven = weightedAvgPrice > 0 ? Math.max(0, Math.ceil((costsTotal - barRevenue - otherRevenue) / weightedAvgPrice)) : 0;
    const profitMargin = revenueTotal > 0 ? (profitLoss / revenueTotal) * 100 : 0;
    const revenuePerGuest = totalExpectedTickets > 0 ? revenueTotal / totalExpectedTickets : 0;
    const costPerGuest = totalExpectedTickets > 0 ? costsTotal / totalExpectedTickets : 0;
    const resultValues: Record<string, number> = {
      total_revenue: revenueTotal, total_costs: costsTotal, profit_loss: profitLoss,
      breakeven_tickets: breakeven, profit_margin: profitMargin,
      revenue_per_guest: revenuePerGuest, cost_per_guest: costPerGuest,
    };
    const newResults = resultFields.map(f => {
      if (manualOverrides[f.id] !== undefined) {
        const val = manualOverrides[f.id];
        if (Math.abs(val - f.value) > 0.001) { changed = true; return { ...f, value: val }; }
        return f;
      }
      if (resultValues[f.id] !== undefined) {
        const val = resultValues[f.id];
        if (Math.abs(val - f.value) > 0.001) { changed = true; return { ...f, value: val }; }
      } else if (f.type === "calculated" && f.formula) {
        const val = evaluateFormula(f.formula, getFieldValue);
        if (Math.abs(val - f.value) > 0.001) { changed = true; return { ...f, value: val }; }
      }
      return f;
    });
    if (changed) { setRevenueFields(newRevenue); setCostFields(newCosts); setResultFields(newResults); }
  }, [revenueFields, costFields, resultFields, getFieldValue, event.capacity, totalTicketRevenue, totalExpectedTickets, weightedAvgPrice, manualOverrides, localTicketTypes, ticketExpectedSold]);

  const BUDGET_SAVE_DEBOUNCE_MS = 150;
  useEffect(() => {
    if (!onBudgetChangeRef.current) return;
    const payload: BudgetCalculatorPersisted = { revenueFields, costFields, resultFields, manualOverrides, localTicketTypes, ticketExpectedSold };
    const sig = JSON.stringify(payload);
    if (sig === lastHydratedJson.current) return;
    const t = window.setTimeout(() => { onBudgetChangeRef.current?.(payload); }, BUDGET_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [revenueFields, costFields, resultFields, manualOverrides, localTicketTypes, ticketExpectedSold]);

  const updateField = (category: "revenue" | "cost" | "result", id: string, updates: Partial<BudgetField>) => {
    const setter = category === "revenue" ? setRevenueFields : category === "cost" ? setCostFields : setResultFields;
    setter(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeField = (category: "revenue" | "cost" | "result", id: string) => {
    if (id === "capacity") return;
    const setter = category === "revenue" ? setRevenueFields : category === "cost" ? setCostFields : setResultFields;
    setter(prev => prev.filter(f => f.id !== id));
  };

  const addCustomField = (field: BudgetField) => {
    const setter = field.category === "revenue" ? setRevenueFields : field.category === "cost" ? setCostFields : setResultFields;
    setter(prev => [...prev, field]);
  };

  const handleLoadTemplate = (template: BudgetTemplate) => {
    setRevenueFields(template.revenueFields);
    setCostFields(template.costFields);
    setResultFields(template.resultFields);
    setManualOverrides({});
    setLocalTicketTypes([]);
    setTicketExpectedSold({});
  };

  const makeLocalTicketId = () => { localTicketIdRef.current += 1; return `lt-${localTicketIdRef.current}`; };

  const revenueFallback = revenueFields.filter(f => !["capacity", "avg_bar_spend", "total_expected_tickets"].includes(f.id)).reduce((s, f) => s + f.value, 0) + totalTicketRevenue;
  const costsFallback = costFields.reduce((s, f) => s + f.value, 0);
  const totalRevenue = resultFields.some(f => f.id === "total_revenue") ? getFieldValue("total_revenue") : revenueFallback;
  const totalCosts = resultFields.some(f => f.id === "total_costs") ? getFieldValue("total_costs") : costsFallback;
  const profitLoss = totalRevenue - totalCosts;
  const breakeven = getFieldValue("breakeven_tickets");

  const formatResult = (field: BudgetField, fc: (amount: number) => string) => {
    if (field.id === "profit_margin") return `${field.value.toFixed(1)}%`;
    if (field.id === "breakeven_tickets") return Math.round(field.value).toLocaleString();
    return fc(field.value);
  };

  return {
    // State
    revenueFields,
    costFields,
    resultFields,
    manualOverrides,
    localTicketTypes,
    ticketExpectedSold,
    // Derived
    allFields,
    ticketRevenueItems,
    totalTicketRevenue,
    totalExpectedTickets,
    weightedAvgPrice,
    totalRevenue,
    totalCosts,
    profitLoss,
    breakeven,
    isDraft,
    // Getters
    getFieldValue,
    getFieldName,
    formatResult,
    makeLocalTicketId,
    // Mutators
    updateField,
    removeField,
    addCustomField,
    handleLoadTemplate,
    setLocalTicketTypes,
    setTicketExpectedSold,
    setManualOverrides,
  };
}
