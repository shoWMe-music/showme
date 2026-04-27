import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type BudgetField } from "@/lib/budget-types";
import { BarChartIcon } from "./BarChartIcon";

interface ResultsSectionProps {
  resultFields: BudgetField[];
  editingResultId: string | null;
  manualOverrides: Record<string, number>;
  formatResult: (field: BudgetField) => string;
  onSetEditingResultId: (id: string | null) => void;
  onSetManualOverride: (fieldId: string, value: number) => void;
  onClearManualOverride: (fieldId: string) => void;
  onRemoveField: (id: string) => void;
  onAddField: () => void;
}

export function ResultsSection({
  resultFields,
  editingResultId,
  manualOverrides,
  formatResult,
  onSetEditingResultId,
  onSetManualOverride,
  onClearManualOverride,
  onRemoveField,
  onAddField,
}: ResultsSectionProps) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h4 className="font-display text-sm font-semibold mb-3 flex items-center gap-2">
        <BarChartIcon className="h-3.5 w-3.5 text-primary" /> Results
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {resultFields.map(field => (
          <div
            key={field.id}
            className={cn(
              "rounded-lg p-3 border group relative",
              field.id === "profit_loss"
                ? field.value >= 0 ? "bg-[hsl(var(--success))]/5 border-[hsl(var(--success))]/20" : "bg-destructive/5 border-destructive/20"
                : "bg-muted/30"
            )}
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground mb-0.5">{field.name}</p>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="h-4 w-4 flex items-center justify-center rounded hover:bg-muted"
                  onClick={() => onSetEditingResultId(editingResultId === field.id ? null : field.id)}
                  title="Manual override"
                >
                  <Edit2 className="h-2.5 w-2.5 text-muted-foreground" />
                </button>
                <button
                  className="h-4 w-4 flex items-center justify-center rounded hover:bg-muted"
                  onClick={() => onRemoveField(field.id)}
                  title="Remove"
                >
                  <Trash2 className="h-2.5 w-2.5 text-destructive" />
                </button>
              </div>
            </div>
            {editingResultId === field.id ? (
              <Input
                type="number"
                value={(manualOverrides[field.id] ?? field.value) || ""}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  onSetManualOverride(field.id, val);
                }}
                onBlur={() => onSetEditingResultId(null)}
                autoFocus
                className="h-7 text-sm font-bold mt-1"
              />
            ) : (
              <p
                className={cn(
                  "text-base font-bold font-display",
                  field.id === "profit_loss" && (field.value >= 0 ? "text-[hsl(var(--success))]" : "text-destructive"),
                  field.id === "total_revenue" && "text-[hsl(var(--success))]",
                  field.id === "total_costs" && "text-destructive",
                )}
              >
                {formatResult(field)}
              </p>
            )}
            {manualOverrides[field.id] !== undefined && editingResultId !== field.id && (
              <button
                className="text-[9px] text-muted-foreground underline"
                onClick={() => onClearManualOverride(field.id)}
              >
                Reset to auto
              </button>
            )}
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="mt-2 gap-1.5 text-[11px] h-7" onClick={onAddField}>
        <Plus className="h-3 w-3" /> Add Result Field
      </Button>
    </div>
  );
}
