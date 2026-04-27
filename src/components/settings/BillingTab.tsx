import { Badge } from "@/components/ui/badge";

export function BillingTab() {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="font-display text-lg font-semibold mb-4">Subscription & Billing</h3>
      <div className="rounded-lg border p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Professional Plan</p>
          <Badge variant="secondary">Active</Badge>
        </div>
        <p className="text-xs text-muted-foreground">€49/month · Renews on April 1, 2026</p>
      </div>
    </div>
  );
}
