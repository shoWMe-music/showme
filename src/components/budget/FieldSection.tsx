import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/models";
import { type BudgetField, formulaToString } from "@/lib/budget-types";

interface FieldSectionProps {
  title: string;
  fields: BudgetField[];
  color: "success" | "destructive";
  onUpdateField: (id: string, updates: Partial<BudgetField>) => void;
  onRemoveField: (id: string) => void;
  onAddField: () => void;
  getFieldValue: (id: string) => number;
  getFieldName: (id: string) => string;
  allFields: BudgetField[];
  currency?: string;
}

export function FieldSection({
  title,
  fields,
  color,
  onUpdateField,
  onRemoveField,
  onAddField,
  getFieldName,
  currency,
}: FieldSectionProps) {
  const borderColor = color === "success" ? "border-l-[hsl(var(--success))]" : "border-l-destructive";

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h4 className={cn("font-display text-sm font-semibold mb-3", color === "success" ? "text-[hsl(var(--success))]" : "text-destructive")}>
        {title}
      </h4>
      <div className="space-y-1.5">
        {fields.map(field => (
          <div key={field.id} className={cn("flex items-center gap-2 rounded-lg border border-l-2 p-2 transition-colors hover:bg-muted/30", borderColor)}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">{field.name}</p>
              {field.type === "calculated" && field.formula && (
                <p className="text-[10px] text-muted-foreground truncate">{formulaToString(field.formula, getFieldName)}</p>
              )}
              {field.id === "pro_cost" && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Select
                    value={field.config?.proType || "none"}
                    onValueChange={(v) => onUpdateField(field.id, { config: { ...field.config, proType: v as NonNullable<BudgetField["config"]>["proType"] } })}
                  >
                    <SelectTrigger className="h-6 w-28 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="stim">STIM</SelectItem>
                      <SelectItem value="gema">GEMA</SelectItem>
                      <SelectItem value="custom_percent">Custom %</SelectItem>
                    </SelectContent>
                  </Select>
                  {field.config?.proType === "custom_percent" && (
                    <Input
                      type="number"
                      value={field.config?.proCustomPercent ?? 5}
                      onChange={(e) => onUpdateField(field.id, { config: { ...field.config, proCustomPercent: parseFloat(e.target.value) || 0 } })}
                      className="h-6 w-14 text-[11px]"
                      placeholder="%"
                    />
                  )}
                </div>
              )}
              {field.id === "payment_fees" && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Input
                    type="number"
                    value={field.config?.paymentFeePercent ?? 2.9}
                    onChange={(e) => onUpdateField(field.id, { config: { ...field.config, paymentFeePercent: parseFloat(e.target.value) || 0 } })}
                    className="h-6 w-14 text-[11px]"
                  />
                  <span className="text-[10px] text-muted-foreground">% +</span>
                  <Input
                    type="number"
                    value={field.config?.paymentFeeFixed ?? 0}
                    onChange={(e) => onUpdateField(field.id, { config: { ...field.config, paymentFeeFixed: parseFloat(e.target.value) || 0 } })}
                    className="h-6 w-14 text-[11px]"
                    placeholder="Fixed"
                  />
                  <span className="text-[10px] text-muted-foreground">/ticket</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {field.type === "manual" && !field.readOnly ? (
                <Input
                  type="number"
                  value={field.value || ""}
                  onChange={(e) => onUpdateField(field.id, { value: parseFloat(e.target.value) || 0 })}
                  className="w-32 h-7 text-xs text-right"
                  placeholder="0"
                />
              ) : (
                <span className={cn("text-xs font-semibold w-24 text-right", color === "success" ? "text-[hsl(var(--success))]" : "text-destructive")}>
                  {formatCurrency(field.value, currency)}
                </span>
              )}
              {!field.readOnly && field.removable !== false ? (
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onRemoveField(field.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              ) : (
                <div className="w-6 shrink-0" />
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
