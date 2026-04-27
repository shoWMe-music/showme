import { Button } from "@/components/ui/button";

const otherIntegrations = [
  { name: "Google Calendar", desc: "Sync events to Google Calendar", connected: false },
];

export function IntegrationsTab() {
  return (
    <div className="space-y-6">

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Other Integrations</h3>
        <div className="space-y-3">
          {otherIntegrations.map((int) => (
            <div key={int.name} className="flex items-center justify-between rounded-lg border p-3">
              <div><p className="text-sm font-medium">{int.name}</p><p className="text-xs text-muted-foreground">{int.desc}</p></div>
              <Button variant="outline" size="sm">{int.connected ? "Connected" : "Connect"}</Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
