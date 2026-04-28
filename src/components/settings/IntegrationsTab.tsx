import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

export function IntegrationsTab() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Calendar</h3>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Google Calendar</p>
                <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Sync your events bidirectionally with Google Calendar</p>
            </div>
          </div>
          <Button variant="outline" size="sm" disabled onClick={() => toast({ title: "Coming soon" })}>
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
}
