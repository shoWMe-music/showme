import { Calculator, TrendingUp, TrendingDown, DollarSign, Target, Save, FolderOpen, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import BudgetExportActions from "@/components/BudgetExportActions";
import { type BudgetField } from "@/lib/budget-types";
import { type Event as AppEvent } from "@/lib/models";
import { SummaryCard } from "./SummaryCard";

interface BudgetHeaderProps {
  event: AppEvent;
  isDraft: boolean;
  revenueFields: BudgetField[];
  costFields: BudgetField[];
  resultFields: BudgetField[];
  getFieldValue: (id: string) => number;
  currency: string;
  totalRevenue: number;
  totalCosts: number;
  profitLoss: number;
  breakeven: number;
  formatCurrency: (amount: number) => string;
  onLoadTemplate: () => void;
  onSaveTemplate: () => void;
}

export function BudgetHeader({
  event,
  isDraft,
  revenueFields,
  costFields,
  resultFields,
  getFieldValue,
  currency,
  totalRevenue,
  totalCosts,
  profitLoss,
  breakeven,
  formatCurrency: fc,
  onLoadTemplate,
  onSaveTemplate,
}: BudgetHeaderProps) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display text-lg font-semibold flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" /> Expenses & Budget Calculator
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onLoadTemplate}>
            <FolderOpen className="h-3.5 w-3.5" /> Load Template
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onSaveTemplate}>
            <Save className="h-3.5 w-3.5" /> Save as Template
          </Button>
          <BudgetExportActions
            event={event}
            revenueFields={revenueFields}
            costFields={costFields}
            resultFields={resultFields}
            getFieldValue={getFieldValue}
            currency={currency}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mb-6">
        <Info className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
        <p className="text-xs text-muted-foreground">
          {isDraft ? "Event is in draft — fill in your estimates manually." : "This is an estimate only and should be reviewed before final decisions."}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={<TrendingUp className="h-5 w-5" />} label="Total Revenue" value={fc(totalRevenue)} variant="success" />
        <SummaryCard icon={<TrendingDown className="h-5 w-5" />} label="Total Costs" value={fc(totalCosts)} variant="destructive" />
        <SummaryCard icon={<DollarSign className="h-5 w-5" />} label="Profit / Loss" value={fc(profitLoss)} variant={profitLoss >= 0 ? "success" : "destructive"} />
        <SummaryCard icon={<Target className="h-5 w-5" />} label="Break-even Tickets" value={Math.round(breakeven).toLocaleString()} variant="warning" />
      </div>
    </div>
  );
}
