import { useState } from "react";
import { formatCurrency, type Event as AppEvent, type TicketRevenue } from "@/lib/models";
import { type BudgetCalculatorPersisted } from "@/lib/budget-types";
import FormulaBuilder from "./FormulaBuilder";
import BudgetTemplateDialog from "./BudgetTemplateDialog";
import BudgetCharts from "./BudgetCharts";
import { BudgetHeader } from "./budget/BudgetHeader";
import { RevenueSection } from "./budget/RevenueSection";
import { FieldSection } from "./budget/FieldSection";
import { ResultsSection } from "./budget/ResultsSection";
import { useBudgetCalculator } from "./budget/useBudgetCalculator";

interface BudgetCalculatorProps {
  eventId: string;
  event: AppEvent;
  revenue?: TicketRevenue;
  currency?: string;
  /** Profile doc ID for budget template scope. */
  profileId?: string;
  /** Persisted snapshot from `events/{eventId}/budgets/{profileDocId}`. */
  initialPersisted?: BudgetCalculatorPersisted | null;
  onBudgetChange?: (data: BudgetCalculatorPersisted) => void;
  childArtistFees?: { artist: string; fee: number }[];
  todoBudgetItems?: { id: string; name: string; type: "cost" | "revenue"; amount: number }[];
}

export default function BudgetCalculator({
  eventId: _eventId,
  event,
  revenue,
  currency = "EUR",
  profileId,
  initialPersisted,
  onBudgetChange,
  childArtistFees,
  todoBudgetItems,
}: BudgetCalculatorProps) {
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaCategory, setFormulaCategory] = useState<"revenue" | "cost" | "result">("revenue");
  const [templateMode, setTemplateMode] = useState<"save" | "load">("load");
  const [templateOpen, setTemplateOpen] = useState(false);

  const budget = useBudgetCalculator({ event, revenue, currency, initialPersisted, onBudgetChange, childArtistFees, todoBudgetItems });

  const fc = (amount: number) => formatCurrency(amount, currency);

  return (
    <div className="space-y-6">
      <BudgetHeader
        event={event}
        isDraft={budget.isDraft}
        revenueFields={budget.revenueFields}
        costFields={budget.costFields}
        resultFields={budget.resultFields}
        getFieldValue={budget.getFieldValue}
        currency={currency}
        totalRevenue={budget.totalRevenue}
        totalCosts={budget.totalCosts}
        profitLoss={budget.profitLoss}
        breakeven={budget.breakeven}
        formatCurrency={fc}
        onLoadTemplate={() => { setTemplateMode("load"); setTemplateOpen(true); }}
        onSaveTemplate={() => { setTemplateMode("save"); setTemplateOpen(true); }}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RevenueSection
          revenueFields={budget.revenueFields}
          ticketRevenueItems={budget.ticketRevenueItems}
          totalTicketRevenue={budget.totalTicketRevenue}
          formatCurrency={fc}
          getFieldName={budget.getFieldName}
          onUpdateField={(id, updates) => budget.updateField("revenue", id, updates)}
          onRemoveField={(id) => budget.removeField("revenue", id)}
          onAddField={() => { setFormulaCategory("revenue"); setFormulaOpen(true); }}
          onUpdateLocalName={(localId, name) =>
            budget.setLocalTicketTypes(prev => prev.map(t => t.id === localId ? { ...t, name } : t))
          }
          onUpdateLocalPrice={(localId, price) =>
            budget.setLocalTicketTypes(prev => prev.map(t => t.id === localId ? { ...t, price } : t))
          }
          onUpdateExpectedSold={(item, v) => {
            if (item.isLocal) {
              budget.setLocalTicketTypes(prev => prev.map(t => t.id === item.localId ? { ...t, expectedSold: v } : t));
            } else {
              budget.setTicketExpectedSold(prev => ({ ...prev, [item.key]: v }));
            }
          }}
          onRemoveTicket={(item) => {
            if (item.isLocal) {
              budget.setLocalTicketTypes(prev => prev.filter(t => t.id !== item.localId));
            } else {
              budget.setTicketExpectedSold(prev => { const n = { ...prev }; delete n[item.key]; return n; });
            }
          }}
          onAddTicketType={() =>
            budget.setLocalTicketTypes(prev => [...prev, { id: budget.makeLocalTicketId(), name: "", price: 0, expectedSold: 0 }])
          }
        />

        <FieldSection
          title="Costs"
          fields={budget.costFields}
          color="destructive"
          onUpdateField={(id, updates) => budget.updateField("cost", id, updates)}
          onRemoveField={(id) => budget.removeField("cost", id)}
          onAddField={() => { setFormulaCategory("cost"); setFormulaOpen(true); }}
          getFieldValue={budget.getFieldValue}
          getFieldName={budget.getFieldName}
          allFields={budget.allFields}
          currency={currency}
        />
      </div>

      <ResultsSection
        resultFields={budget.resultFields}
        editingResultId={editingResultId}
        manualOverrides={budget.manualOverrides}
        formatResult={(field) => budget.formatResult(field, fc)}
        onSetEditingResultId={setEditingResultId}
        onSetManualOverride={(fieldId, val) => budget.setManualOverrides(prev => ({ ...prev, [fieldId]: val }))}
        onClearManualOverride={(fieldId) => budget.setManualOverrides(prev => { const n = { ...prev }; delete n[fieldId]; return n; })}
        onRemoveField={(id) => budget.removeField("result", id)}
        onAddField={() => { setFormulaCategory("result"); setFormulaOpen(true); }}
      />

      <BudgetCharts
        ticketPrice={budget.weightedAvgPrice}
        totalCosts={budget.totalCosts}
        barRevenue={budget.getFieldValue("bar_revenue")}
        otherRevenue={budget.getFieldValue("other_revenue")}
        revenueFields={budget.revenueFields}
        costFields={budget.costFields}
        breakevenTickets={budget.breakeven}
        expectedTickets={budget.totalExpectedTickets}
        capacity={budget.revenueFields.find(f => f.id === "capacity")?.value ?? event.capacity ?? 0}
        currency={currency}
      />

      <FormulaBuilder
        open={formulaOpen}
        onOpenChange={setFormulaOpen}
        allFields={budget.allFields}
        category={formulaCategory}
        onSave={budget.addCustomField}
        getFieldValue={budget.getFieldValue}
      />
      <BudgetTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        mode={templateMode}
        profileId={profileId || ""}
        currentFields={{ revenueFields: budget.revenueFields, costFields: budget.costFields, resultFields: budget.resultFields }}
        onLoad={budget.handleLoadTemplate}
      />
    </div>
  );
}
