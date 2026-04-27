import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BudgetField, FormulaNode } from "@/lib/budget-types";
import { evaluateFormula, formulaToString } from "@/lib/budget-types";
import { formatCurrency } from "@/lib/models";

interface FormulaBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allFields: BudgetField[];
  category: "revenue" | "cost" | "result";
  onSave: (field: BudgetField) => void;
  getFieldValue: (id: string) => number;
}

type FormulaType = "manual" | "percentage" | "add" | "subtract" | "multiply" | "divide";

export default function FormulaBuilder({ open, onOpenChange, allFields, category, onSave, getFieldValue }: FormulaBuilderProps) {
  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<"manual" | "calculated">("manual");
  const [formulaType, setFormulaType] = useState<FormulaType>("percentage");
  const [percentValue, setPercentValue] = useState(10);
  const [refField1, setRefField1] = useState("");
  const [refField2, setRefField2] = useState("");
  const [constantValue, setConstantValue] = useState(0);
  const [useConstant, setUseConstant] = useState(false);

  const availableFields = allFields.filter(f => !["capacity"].includes(f.id));
  const getFieldName = (id: string) => allFields.find(f => f.id === id)?.name || id;

  const buildFormula = (): FormulaNode | undefined => {
    if (fieldType === "manual") return undefined;
    if (formulaType === "percentage" && refField1) {
      return { op: "percentage", percent: percentValue, ofFieldId: refField1 };
    }
    if (["add", "subtract", "multiply", "divide"].includes(formulaType)) {
      const left: FormulaNode = refField1 ? { op: "ref", fieldId: refField1 } : { op: "constant", value: 0 };
      const right: FormulaNode = useConstant ? { op: "constant", value: constantValue } : refField2 ? { op: "ref", fieldId: refField2 } : { op: "constant", value: 0 };
      return { op: formulaType as "add" | "subtract" | "multiply" | "divide", left, right };
    }
    return undefined;
  };

  const formula = buildFormula();
  const preview = formula ? evaluateFormula(formula, getFieldValue) : 0;
  const formulaText = formula ? formulaToString(formula, getFieldName) : "—";

  const handleSave = () => {
    if (!name.trim()) return;
    const newField: BudgetField = {
      id: `custom_${Date.now()}`,
      name: name.trim(),
      category,
      type: fieldType,
      value: fieldType === "manual" ? 0 : preview,
      formula: formula,
      isDefault: false,
      removable: true,
      order: allFields.filter(f => f.category === category).length,
    };
    onSave(newField);
    setName("");
    setFieldType("manual");
    setFormulaType("percentage");
    setPercentValue(10);
    setRefField1("");
    setRefField2("");
    setConstantValue(0);
    setUseConstant(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Custom {category === "revenue" ? "Revenue" : category === "cost" ? "Cost" : "Result"} Field</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Field name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sponsor income, Security cost..." className="mt-1" />
          </div>

          <div>
            <Label>Type</Label>
            <Select value={fieldType} onValueChange={(v) => setFieldType(v as "manual" | "calculated")}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual amount</SelectItem>
                <SelectItem value="calculated">Auto-calculated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {fieldType === "calculated" && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div>
                <Label className="text-xs">Calculation</Label>
                <Select value={formulaType} onValueChange={(v) => setFormulaType(v as FormulaType)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage of a field</SelectItem>
                    <SelectItem value="add">Add two values</SelectItem>
                    <SelectItem value="subtract">Subtract</SelectItem>
                    <SelectItem value="multiply">Multiply</SelectItem>
                    <SelectItem value="divide">Divide</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formulaType === "percentage" && (
                <div className="flex items-center gap-2">
                  <Input type="number" value={percentValue} onChange={(e) => setPercentValue(parseFloat(e.target.value) || 0)} className="w-20" />
                  <span className="text-sm text-muted-foreground">% of</span>
                  <Select value={refField1} onValueChange={setRefField1}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select field" /></SelectTrigger>
                    <SelectContent>
                      {availableFields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {["add", "subtract", "multiply", "divide"].includes(formulaType) && (
                <div className="space-y-2">
                  <Select value={refField1} onValueChange={setRefField1}>
                    <SelectTrigger><SelectValue placeholder="First value" /></SelectTrigger>
                    <SelectContent>
                      {availableFields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="text-center text-sm font-medium text-muted-foreground">
                    {formulaType === "add" ? "+" : formulaType === "subtract" ? "−" : formulaType === "multiply" ? "×" : "÷"}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={useConstant} onChange={(e) => setUseConstant(e.target.checked)} className="rounded" />
                      Use number
                    </label>
                  </div>
                  {useConstant ? (
                    <Input type="number" value={constantValue} onChange={(e) => setConstantValue(parseFloat(e.target.value) || 0)} placeholder="Enter number" />
                  ) : (
                    <Select value={refField2} onValueChange={setRefField2}>
                      <SelectTrigger><SelectValue placeholder="Second value" /></SelectTrigger>
                      <SelectContent>
                        {availableFields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              <div className="rounded-md bg-background p-2 border text-xs space-y-1">
                <p className="text-muted-foreground">Formula: <span className="font-medium text-foreground">{formulaText}</span></p>
                <p className="text-muted-foreground">Preview: <span className="font-semibold text-foreground">{formatCurrency(preview)}</span></p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>Add Field</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
