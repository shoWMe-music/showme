// ── Budget Calculator Types ──

export interface BudgetField {
  id: string;
  name: string;
  category: "revenue" | "cost" | "result";
  type: "manual" | "calculated";
  value: number;
  formula?: FormulaNode;
  isDefault?: boolean;
  removable?: boolean;
  readOnly?: boolean;
  order: number;
  // Special config for specific fields
  config?: {
    proType?: "none" | "stim" | "gema" | "custom_percent";
    proCustomPercent?: number;
    paymentFeePercent?: number;
    paymentFeeFixed?: number;
  };
}

export type FormulaNode =
  | { op: "ref"; fieldId: string }
  | { op: "constant"; value: number }
  | { op: "add"; left: FormulaNode; right: FormulaNode }
  | { op: "subtract"; left: FormulaNode; right: FormulaNode }
  | { op: "multiply"; left: FormulaNode; right: FormulaNode }
  | { op: "divide"; left: FormulaNode; right: FormulaNode }
  | { op: "percentage"; percent: number; ofFieldId: string };

export interface BudgetTemplate {
  id: string;
  name: string;
  type: "venue_default" | "promoter" | "custom";
  revenueFields: BudgetField[];
  costFields: BudgetField[];
  resultFields: BudgetField[];
}

/** Snapshot stored at `events/{eventId}/budgets/{docId}` — `ownerUid__slot` or personal `ownerUid`. */
export interface BudgetCalculatorPersisted {
  revenueFields: BudgetField[];
  costFields: BudgetField[];
  resultFields: BudgetField[];
  manualOverrides?: Record<string, number>;
  localTicketTypes?: { id: string; name: string; price: number; expectedSold: number }[];
  ticketExpectedSold?: Record<string, number>;
}

// ── Default field definitions ──

export function getDefaultRevenueFields(): BudgetField[] {
  return [
    { id: "capacity", name: "Capacity", category: "revenue", type: "manual", value: 0, isDefault: true, removable: false, order: 0 },
    { id: "avg_bar_spend", name: "Average bar spend per guest", category: "revenue", type: "manual", value: 0, isDefault: true, removable: true, order: 1 },
    { id: "bar_revenue", name: "Bar revenue", category: "revenue", type: "calculated", value: 0, isDefault: true, removable: true, order: 2,
      formula: { op: "multiply", left: { op: "ref", fieldId: "total_expected_tickets" }, right: { op: "ref", fieldId: "avg_bar_spend" } } },
    { id: "other_revenue", name: "Other revenue", category: "revenue", type: "manual", value: 0, isDefault: true, removable: true, order: 3 },
  ];
}

export function getDefaultCostFields(): BudgetField[] {
  return [
    { id: "artist_fee", name: "Performer fee", category: "cost", type: "manual", value: 0, isDefault: true, removable: true, order: 0 },
    { id: "production_cost", name: "Production cost", category: "cost", type: "manual", value: 0, isDefault: true, removable: true, order: 1 },
    { id: "staff_cost", name: "Staff cost", category: "cost", type: "manual", value: 0, isDefault: true, removable: true, order: 2 },
    { id: "marketing_cost", name: "Marketing cost", category: "cost", type: "manual", value: 0, isDefault: true, removable: true, order: 3 },
    { id: "venue_cost", name: "Venue cost", category: "cost", type: "manual", value: 0, isDefault: true, removable: true, order: 4 },
    { id: "other_cost", name: "Other cost", category: "cost", type: "manual", value: 0, isDefault: true, removable: true, order: 5 },
    { id: "pro_cost", name: "PRO cost", category: "cost", type: "manual", value: 0, isDefault: true, removable: true, order: 6,
      config: { proType: "none", proCustomPercent: 5 } },
    { id: "payment_fees", name: "Payment processing fees", category: "cost", type: "calculated", value: 0, isDefault: true, removable: true, order: 7,
      config: { paymentFeePercent: 1.5, paymentFeeFixed: 0 } },
  ];
}

export function getDefaultResultFields(): BudgetField[] {
  return [
    { id: "total_revenue", name: "Total revenue", category: "result", type: "calculated", value: 0, isDefault: true, removable: true, order: 0 },
    { id: "total_costs", name: "Total costs", category: "result", type: "calculated", value: 0, isDefault: true, removable: true, order: 1 },
    { id: "profit_loss", name: "Profit / Loss", category: "result", type: "calculated", value: 0, isDefault: true, removable: true, order: 2 },
    { id: "breakeven_tickets", name: "Break-even ticket count", category: "result", type: "calculated", value: 0, isDefault: true, removable: true, order: 3 },
    { id: "profit_margin", name: "Profit margin %", category: "result", type: "calculated", value: 0, isDefault: true, removable: true, order: 4 },
    { id: "revenue_per_guest", name: "Revenue per guest", category: "result", type: "calculated", value: 0, isDefault: true, removable: true, order: 5 },
    { id: "cost_per_guest", name: "Cost per guest", category: "result", type: "calculated", value: 0, isDefault: true, removable: true, order: 6 },
  ];
}

// ── Formula evaluation ──

export function evaluateFormula(formula: FormulaNode, getFieldValue: (id: string) => number): number {
  switch (formula.op) {
    case "ref": return getFieldValue(formula.fieldId);
    case "constant": return formula.value;
    case "add": return evaluateFormula(formula.left, getFieldValue) + evaluateFormula(formula.right, getFieldValue);
    case "subtract": return evaluateFormula(formula.left, getFieldValue) - evaluateFormula(formula.right, getFieldValue);
    case "multiply": return evaluateFormula(formula.left, getFieldValue) * evaluateFormula(formula.right, getFieldValue);
    case "divide": {
      const divisor = evaluateFormula(formula.right, getFieldValue);
      return divisor === 0 ? 0 : evaluateFormula(formula.left, getFieldValue) / divisor;
    }
    case "percentage": return (formula.percent / 100) * getFieldValue(formula.ofFieldId);
    default: return 0;
  }
}

// ── Human-readable formula ──

export function formulaToString(formula: FormulaNode, getFieldName: (id: string) => string): string {
  switch (formula.op) {
    case "ref": return getFieldName(formula.fieldId);
    case "constant": return formula.value.toString();
    case "add": return `${formulaToString(formula.left, getFieldName)} + ${formulaToString(formula.right, getFieldName)}`;
    case "subtract": return `${formulaToString(formula.left, getFieldName)} − ${formulaToString(formula.right, getFieldName)}`;
    case "multiply": return `${formulaToString(formula.left, getFieldName)} × ${formulaToString(formula.right, getFieldName)}`;
    case "divide": return `${formulaToString(formula.left, getFieldName)} ÷ ${formulaToString(formula.right, getFieldName)}`;
    case "percentage": return `${formula.percent}% of ${getFieldName(formula.ofFieldId)}`;
    default: return "—";
  }
}
