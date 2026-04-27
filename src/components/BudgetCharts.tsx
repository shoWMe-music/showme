import { useMemo } from "react";
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, ReferenceLine } from "recharts";
import type { BudgetField } from "@/lib/budget-types";
import { formatCurrency } from "@/lib/models";

interface BudgetChartsProps {
  ticketPrice: number;
  totalCosts: number;
  barRevenue: number;
  otherRevenue: number;
  revenueFields: BudgetField[];
  costFields: BudgetField[];
  breakevenTickets: number;
  expectedTickets: number;
  capacity?: number;
  currency?: string;
}

const REVENUE_COLORS = ["hsl(142, 71%, 45%)", "hsl(142, 60%, 55%)", "hsl(142, 50%, 65%)", "hsl(160, 60%, 50%)", "hsl(180, 50%, 50%)"];
const COST_COLORS = ["hsl(0, 72%, 51%)", "hsl(0, 60%, 60%)", "hsl(15, 70%, 55%)", "hsl(30, 70%, 55%)", "hsl(350, 60%, 60%)", "hsl(0, 50%, 65%)", "hsl(20, 60%, 55%)", "hsl(340, 50%, 55%)"];

export default function BudgetCharts({ ticketPrice, totalCosts, barRevenue, otherRevenue, revenueFields, costFields, breakevenTickets, expectedTickets, capacity = 0, currency = "EUR" }: BudgetChartsProps) {
  const fc = (amount: number) => formatCurrency(amount, currency);

  // Break-even chart data — capped by capacity
  const breakevenData = useMemo(() => {
    const maxTickets = capacity > 0 ? capacity : Math.max(expectedTickets * 1.5, breakevenTickets * 1.5, 100);
    const steps = 20;
    const step = Math.ceil(maxTickets / steps);
    return Array.from({ length: steps + 1 }, (_, i) => {
      const tickets = Math.min(i * step, maxTickets);
      const revenue = tickets * ticketPrice + barRevenue + otherRevenue;
      const profit = revenue - totalCosts;
      const profitCap = Math.max(0, profit);
      const lossCap = Math.min(0, profit);
      return { tickets, profit, revenue, profitCap, lossCap };
    });
  }, [ticketPrice, totalCosts, barRevenue, otherRevenue, breakevenTickets, expectedTickets, capacity]);

  // Revenue breakdown for pie chart
  const revenuePieData = useMemo(() => {
    return revenueFields
      .filter(f => f.value > 0 && !["capacity", "avg_bar_spend", "total_expected_tickets"].includes(f.id) && !f.id.startsWith("tt_expected_"))
      .map(f => ({ name: f.name, value: f.value }));
  }, [revenueFields]);

  // Cost breakdown for bar chart
  const costBarData = useMemo(() => {
    return costFields.filter(f => f.value > 0).map(f => ({ name: f.name, value: f.value }));
  }, [costFields]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Break-even Chart */}
      <div className="rounded-xl border bg-card p-5 shadow-sm lg:col-span-2">
        <h4 className="text-sm font-semibold mb-4">Break-even Analysis</h4>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={breakevenData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="tickets" fontSize={11} tickFormatter={(v) => v.toLocaleString()} label={{ value: "Tickets sold", position: "insideBottom", offset: -5, fontSize: 11 }} />
            <YAxis fontSize={11} tickFormatter={(v) => fc(v)} />
            <Tooltip formatter={(value: number) => fc(value)} labelFormatter={(label) => `${label} tickets`} />
            <defs>
              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="lossGradient" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <ReferenceLine y={0} stroke="hsl(220, 10%, 46%)" strokeDasharray="4 4" />
            {breakevenTickets > 0 && (
              <ReferenceLine x={breakevenTickets} stroke="hsl(38, 92%, 50%)" strokeDasharray="4 4" label={{ value: `Break-even: ${breakevenTickets}`, position: "top", fontSize: 10, fill: "hsl(38, 92%, 50%)" }} />
            )}
            {capacity > 0 && (
              <ReferenceLine x={capacity} stroke="hsl(220, 70%, 50%)" strokeDasharray="4 4" label={{ value: `Capacity: ${capacity}`, position: "top", fontSize: 10, fill: "hsl(220, 70%, 50%)" }} />
            )}
            <Area type="monotone" dataKey="lossCap" baseLine={0} stroke="none" fill="url(#lossGradient)" tooltipType="none" isAnimationActive={false} />
            <Area type="monotone" dataKey="profitCap" baseLine={0} stroke="none" fill="url(#profitGradient)" tooltipType="none" isAnimationActive={false} />
            <Line type="monotone" dataKey="profit" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={false} name="Profit / Loss" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue Breakdown */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h4 className="text-sm font-semibold mb-4">Revenue Sources</h4>
        {revenuePieData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={revenuePieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                {revenuePieData.map((_, i) => (
                  <Cell key={i} fill={REVENUE_COLORS[i % REVENUE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => fc(value)} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No revenue data yet</div>
        )}
        <div className="space-y-1 mt-2">
          {revenuePieData.map((d, i) => (
            <div key={d.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: REVENUE_COLORS[i % REVENUE_COLORS.length] }} />
                <span className="text-muted-foreground">{d.name}</span>
              </div>
              <span className="font-medium">{fc(d.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cost Breakdown */}
      {costBarData.length > 0 && (
        <div className="rounded-xl border bg-card p-5 shadow-sm lg:col-span-3">
          <h4 className="text-sm font-semibold mb-4">Cost Breakdown</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={costBarData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" horizontal={false} />
              <XAxis type="number" fontSize={11} tickFormatter={(v) => fc(v)} />
              <YAxis type="category" dataKey="name" fontSize={11} width={140} />
              <Tooltip formatter={(value: number) => fc(value)} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {costBarData.map((_, i) => (
                  <Cell key={i} fill={COST_COLORS[i % COST_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
