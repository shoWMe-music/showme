import { Badge } from "@/components/ui/badge";
import { useUser } from "@/lib/user-context";

export function BillingTab() {
  const { profiles } = useUser();
  const hasVenueProfile = Object.values(profiles).some(
    (p) => p.created && p.role === "venue",
  );

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="font-display text-lg font-semibold mb-4">Subscription & Billing</h3>
      <div className="rounded-lg border p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">
            {hasVenueProfile ? "Venue Pilot Plan" : "Professional Plan"}
          </p>
          <Badge variant="secondary">
            {hasVenueProfile ? "Pilot" : "Active"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {hasVenueProfile
            ? "Full access during pilot period"
            : "€49/month · Renews on April 1, 2026"}
        </p>
      </div>
    </div>
  );
}
