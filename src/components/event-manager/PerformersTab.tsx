import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { EventStatusBadge } from "@/components/StatusBadge";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/models";
import type { Event } from "@/lib/models";
import type { EventEconomicsData } from "@/lib/queries/useEventEconomics";

interface PerformersTabProps {
  childEvents: Event[];
  childEconomics: Record<string, EventEconomicsData>;
  eventCurrency: string;
}

export function PerformersTab({ childEvents, childEconomics, eventCurrency }: PerformersTabProps) {
  const stages = new Map<string, { capacity: number; performers: string[] }>();
  childEvents.forEach(child => {
    const stage = child.roomStage || "Unassigned";
    const existing = stages.get(stage) || { capacity: 0, performers: [] };
    existing.capacity = Math.max(existing.capacity, child.stageCapacity || child.capacity || 0);
    existing.performers.push(child.artist);
    stages.set(stage, existing);
  });
  const showStages = stages.size > 0 && !(stages.size === 1 && stages.has("Unassigned"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Performers</h3>
      </div>

      {showStages && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Stages / Rooms
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {Array.from(stages.entries())
              .filter(([name]) => name !== "Unassigned")
              .map(([name, info]) => (
                <div key={name} className="rounded-lg border p-3">
                  <p className="font-medium text-sm">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {info.capacity ? `Capacity: ${info.capacity}` : "No capacity set"} · {info.performers.length} performer{info.performers.length !== 1 ? "s" : ""}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {childEvents.length === 0 ? (
        <p className="text-muted-foreground text-sm">No performers added yet.</p>
      ) : (
        <div className="space-y-3">
          {childEvents.map(child => {
            const childDeal = childEconomics[child.id]?.deal;
            const childSettlement = childEconomics[child.id]?.settlement;
            return (
              <Link key={child.id} to="/events/$id" params={{ id: child.id }} className="block rounded-xl border bg-card p-4 shadow-sm hover:border-primary/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                      {child.artist?.charAt(0) || "?"}
                    </div>
                    <div>
                      <p className="font-semibold">{child.artist}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {childDeal?.dealType?.replace("_", " ") || "—"} · Guarantee: {formatCurrency(childDeal?.artistGuarantee || 0, eventCurrency)}
                        {child.roomStage ? ` · ${child.roomStage}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <EventStatusBadge status={child.eventStatus} />
                    {childSettlement && <StatusBadge status={childSettlement.status} />}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
