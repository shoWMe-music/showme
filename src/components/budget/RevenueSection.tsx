import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { type BudgetField, formulaToString } from "@/lib/budget-types";
import { TicketRevenueSection } from "./TicketRevenueSection";

type TicketRevenueRow =
  | { key: string; name: string; price: number; expectedSold: number; revenue: number; isLocal: false }
  | { key: string; name: string; price: number; expectedSold: number; revenue: number; isLocal: true; localId: string };

interface RevenueSectionProps {
  revenueFields: BudgetField[];
  ticketRevenueItems: TicketRevenueRow[];
  totalTicketRevenue: number;
  formatCurrency: (amount: number) => string;
  getFieldName: (id: string) => string;
  onUpdateField: (id: string, updates: Partial<BudgetField>) => void;
  onRemoveField: (id: string) => void;
  onAddField: () => void;
  onUpdateLocalName: (localId: string, name: string) => void;
  onUpdateLocalPrice: (localId: string, price: number) => void;
  onUpdateExpectedSold: (item: TicketRevenueRow, value: number) => void;
  onRemoveTicket: (item: TicketRevenueRow) => void;
  onAddTicketType: () => void;
}

export function RevenueSection({
  revenueFields,
  ticketRevenueItems,
  totalTicketRevenue,
  formatCurrency: fc,
  getFieldName,
  onUpdateField,
  onRemoveField,
  onAddField,
  onUpdateLocalName,
  onUpdateLocalPrice,
  onUpdateExpectedSold,
  onRemoveTicket,
  onAddTicketType,
}: RevenueSectionProps) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h4 className="font-display text-sm font-semibold mb-3 text-[hsl(var(--success))]">Revenue</h4>
      <div className="space-y-1.5">
        <TicketRevenueSection
          ticketRevenueItems={ticketRevenueItems}
          totalTicketRevenue={totalTicketRevenue}
          formatCurrency={fc}
          onUpdateLocalName={onUpdateLocalName}
          onUpdateLocalPrice={onUpdateLocalPrice}
          onUpdateExpectedSold={onUpdateExpectedSold}
          onRemoveTicket={onRemoveTicket}
          onAddTicketType={onAddTicketType}
        />

        {revenueFields.map(field => (
          <div key={field.id} className="flex items-center gap-2 rounded-lg border border-l-2 border-l-[hsl(var(--success))] p-2 transition-colors hover:bg-muted/30">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">{field.name}</p>
              {field.type === "calculated" && field.formula && (
                <p className="text-[10px] text-muted-foreground truncate">{formulaToString(field.formula, getFieldName)}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {field.type === "manual" ? (
                <Input
                  type="number"
                  value={field.value || ""}
                  onChange={(e) => onUpdateField(field.id, { value: parseFloat(e.target.value) || 0 })}
                  className="w-32 h-7 text-xs text-right"
                  placeholder="0"
                />
              ) : (
                <span className="text-xs font-semibold w-24 text-right text-[hsl(var(--success))]">
                  {fc(field.value)}
                </span>
              )}
              {field.removable !== false && (
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onRemoveField(field.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="mt-2 gap-1.5 text-[11px] h-7" onClick={onAddField}>
        <Plus className="h-3 w-3" /> Add Field
      </Button>
    </div>
  );
}
