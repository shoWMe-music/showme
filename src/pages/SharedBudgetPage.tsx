import { useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, DollarSign, Target, Calculator } from "lucide-react";
import { fetchShareTokenPartiesForBudget, ShareAuthRequiredError } from "@/lib/db";
import { queryKeys } from "@/lib/queries";
import { formatCurrency } from "@/lib/models";
import { cn } from "@/lib/utils";
import ShareOtpGate from "@/components/share/ShareOtpGate";

interface SharedField {
  id: string;
  name: string;
  value: number;
}

interface SharedBudget {
  eventName: string;
  eventVenue: string;
  eventDate: string;
  revenueFields: SharedField[];
  costFields: SharedField[];
  resultFields: SharedField[];
  generatedAt: string;
}

interface SharedTodoSchedule {
  type: "todo-schedule";
  eventName: string;
  eventVenue: string;
  eventDate: string;
  todos: { id: string; title: string; dueDate?: string; completed: boolean; description?: string; budgetType?: string; budgetAmount?: number }[];
  generatedAt: string;
}

interface SharedInHouseAssignment {
  type: "in-house";
  eventName: string;
  memberName: string;
  scheduleItems: { id: string; time: string; label: string; assignee: string }[];
  tasks: { id: string; text: string; done: boolean; assignee: string }[];
  privateNotes: { id: string; text: string; assignee: string }[];
  generatedAt: string;
}

const EXCLUDED_REVENUE_IDS = ["ticket_price", "expected_tickets", "capacity", "avg_bar_spend"];

export default function SharedBudgetPage() {
  const { token } = useParams({ from: "/shared/budget/$token" });
  const queryClient = useQueryClient();

  const {
    data: rawData,
    isPending: loading,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.shareBudgetParties(token ?? ""),
    queryFn: async () => {
      if (!token) return null;
      const parties = await fetchShareTokenPartiesForBudget(token);
      return parties || null;
    },
    enabled: !!token,
    // Don't auto-retry — ShareAuthRequiredError is a deliberate signal to gate.
    retry: false,
  });

  if (error instanceof ShareAuthRequiredError && token) {
    return (
      <ShareOtpGate
        token={token}
        onUnlocked={() =>
          void queryClient.invalidateQueries({ queryKey: queryKeys.shareBudgetParties(token) })
        }
      />
    );
  }

  const rawType = rawData && typeof rawData === "object" ? (rawData as Record<string, unknown>).type : undefined;
  const isTodoSchedule = rawType === "todo-schedule";
  const isInHouse = rawType === "in-house";
  const data = isTodoSchedule || isInHouse ? null : (rawData as SharedBudget | null);
  const todoData = isTodoSchedule ? (rawData as unknown as SharedTodoSchedule) : null;
  const inHouseData = isInHouse ? (rawData as unknown as SharedInHouseAssignment) : null;

  const errorMessage =
    isError
      ? "Shared link not found or has expired."
      : !loading && !data && !todoData && !inHouseData
        ? "Shared link not found or has expired."
        : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (todoData) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
        <div>
          <img src="/images/showme-logo.png" alt="shoWMe" className="h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-bold mb-1">Task Schedule</h1>
          <p className="text-sm text-muted-foreground">{todoData.eventName} • {todoData.eventVenue} • {todoData.eventDate}</p>
          <p className="text-xs text-muted-foreground mt-1">Generated {new Date(todoData.generatedAt).toLocaleDateString()}</p>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm space-y-2">
          {todoData.todos.map(t => (
            <div key={t.id} className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", t.completed && "opacity-50")}>
              <div className={cn("h-4 w-4 rounded border flex items-center justify-center shrink-0", t.completed ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground")}>
                {t.completed && <span className="text-[10px]">&#10003;</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", t.completed && "line-through")}>{t.title}</p>
                {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
              </div>
              {t.dueDate && <span className="text-xs text-muted-foreground shrink-0">{t.dueDate}</span>}
            </div>
          ))}
          {todoData.todos.length === 0 && <p className="text-sm text-muted-foreground">No tasks in this schedule.</p>}
        </div>
      </div>
    );
  }

  if (inHouseData) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
        <div>
          <img src="/images/showme-logo.png" alt="shoWMe" className="h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-bold mb-1">In-House Assignment</h1>
          <p className="text-sm text-muted-foreground">{inHouseData.eventName} • {inHouseData.memberName}</p>
          <p className="text-xs text-muted-foreground mt-1">Generated {new Date(inHouseData.generatedAt).toLocaleDateString()}</p>
        </div>

        {inHouseData.scheduleItems.length > 0 && (
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-2">
            <h2 className="text-sm font-semibold mb-2">Schedule</h2>
            {inHouseData.scheduleItems.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border px-4 py-2 text-sm">
                <span className="text-muted-foreground w-14 shrink-0">{s.time}</span>
                <span className="flex-1 font-medium">{s.label}</span>
                {s.assignee && <span className="text-xs text-muted-foreground">{s.assignee}</span>}
              </div>
            ))}
          </div>
        )}

        {inHouseData.tasks.length > 0 && (
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-2">
            <h2 className="text-sm font-semibold mb-2">Tasks</h2>
            {inHouseData.tasks.map(t => (
              <div key={t.id} className={cn("flex items-center gap-3 rounded-lg border px-4 py-2 text-sm", t.done && "opacity-50")}>
                <div className={cn("h-4 w-4 rounded border flex items-center justify-center shrink-0", t.done ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground")}>
                  {t.done && <span className="text-[10px]">&#10003;</span>}
                </div>
                <span className={cn("flex-1", t.done && "line-through")}>{t.text}</span>
                {t.assignee && <span className="text-xs text-muted-foreground">{t.assignee}</span>}
              </div>
            ))}
          </div>
        )}

        {inHouseData.privateNotes.length > 0 && (
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-2">
            <h2 className="text-sm font-semibold mb-2">Notes</h2>
            {inHouseData.privateNotes.map(n => (
              <div key={n.id} className="rounded-lg border px-4 py-2 text-sm">
                <p>{n.text}</p>
                {n.assignee && <p className="text-xs text-muted-foreground mt-1">{n.assignee}</p>}
              </div>
            ))}
          </div>
        )}

        {inHouseData.scheduleItems.length === 0 && inHouseData.tasks.length === 0 && inHouseData.privateNotes.length === 0 && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <p className="text-sm text-muted-foreground">Nothing has been assigned yet.</p>
          </div>
        )}
      </div>
    );
  }

  if (errorMessage || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-destructive">{errorMessage}</p>
          <p className="text-sm text-muted-foreground">The link may be invalid or the report was removed.</p>
        </div>
      </div>
    );
  }

  const getVal = (id: string) => [...data.revenueFields, ...data.costFields, ...data.resultFields].find(f => f.id === id)?.value ?? 0;
  const totalRevenue = getVal("total_revenue");
  const totalCosts = getVal("total_costs");
  const profitLoss = totalRevenue - totalCosts;
  const breakeven = getVal("breakeven_tickets");
  const profitMargin = getVal("profit_margin");

  const formatResult = (f: SharedField) => {
    if (f.id === "profit_margin") return `${f.value.toFixed(1)}%`;
    if (f.id === "breakeven_tickets") return Math.round(f.value).toLocaleString();
    return formatCurrency(f.value);
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Logo */}
      <div>
        <img src="/images/showme-logo.png" alt="shoWMe" className="h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      </div>

      {/* Header */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Calculator className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Budget Report</h1>
        </div>
        <p className="text-sm text-muted-foreground">{data.eventName} • {data.eventVenue} • {data.eventDate}</p>
        <p className="text-xs text-muted-foreground mt-1">Generated {new Date(data.generatedAt).toLocaleDateString()}</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={<TrendingUp className="h-5 w-5" />} label="Total Revenue" value={formatCurrency(totalRevenue)} variant="success" />
        <SummaryCard icon={<TrendingDown className="h-5 w-5" />} label="Total Costs" value={formatCurrency(totalCosts)} variant="destructive" />
        <SummaryCard icon={<DollarSign className="h-5 w-5" />} label="Profit / Loss" value={formatCurrency(profitLoss)} variant={profitLoss >= 0 ? "success" : "destructive"} />
        <SummaryCard icon={<Target className="h-5 w-5" />} label="Break-even" value={`${Math.round(breakeven)} tickets`} variant="warning" />
      </div>

      {/* Profit Margin Bar */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-sm font-semibold mb-2">Profit Margin</p>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", profitMargin >= 20 ? "bg-[hsl(var(--success))]" : profitMargin >= 10 ? "bg-[hsl(var(--warning))]" : "bg-destructive")}
              style={{ width: `${Math.min(Math.max(profitMargin, 0), 100)}%` }}
            />
          </div>
          <span className="text-sm font-bold">{profitMargin.toFixed(1)}%</span>
        </div>
      </div>

      {/* Revenue & Costs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FieldTable title="Revenue" fields={data.revenueFields} color="success" />
        <FieldTable title="Costs" fields={data.costFields} color="destructive" />
      </div>

      {/* Results */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold mb-3">Results</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {data.resultFields.map(f => (
            <div key={f.id} className={cn(
              "rounded-lg p-3 border",
              f.id === "profit_loss" ? (f.value >= 0 ? "bg-[hsl(var(--success))]/5 border-[hsl(var(--success))]/20" : "bg-destructive/5 border-destructive/20") : "bg-muted/30",
            )}>
              <p className="text-[10px] text-muted-foreground mb-0.5">{f.name}</p>
              <p className={cn(
                "text-base font-bold",
                f.id === "profit_loss" && (f.value >= 0 ? "text-[hsl(var(--success))]" : "text-destructive"),
                f.id === "total_revenue" && "text-[hsl(var(--success))]",
                f.id === "total_costs" && "text-destructive",
              )}>
                {formatResult(f)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-center text-muted-foreground">⚠ This is an estimate only and should be reviewed before final decisions.</p>
    </div>
  );
}

function SummaryCard({ icon, label, value, variant }: { icon: React.ReactNode; label: string; value: string; variant: "success" | "destructive" | "warning" }) {
  const colors = {
    success: "bg-[hsl(var(--success))]/5 border-[hsl(var(--success))]/20 text-[hsl(var(--success))]",
    destructive: "bg-destructive/5 border-destructive/20 text-destructive",
    warning: "bg-[hsl(var(--warning))]/5 border-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]",
  };
  return (
    <div className={cn("rounded-xl border p-3", colors[variant])}>
      <div className="flex items-center gap-1.5 mb-1 opacity-70">{icon}<span className="text-[11px] font-medium">{label}</span></div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function FieldTable({ title, fields, color }: { title: string; fields: SharedField[]; color: "success" | "destructive" }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h3 className={cn("text-sm font-semibold mb-3", color === "success" ? "text-[hsl(var(--success))]" : "text-destructive")}>{title}</h3>
      <div className="space-y-1">
        {fields.map(f => (
          <div key={f.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md hover:bg-muted/30">
            <span>{f.name}</span>
            <span className="font-medium">{formatCurrency(f.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
