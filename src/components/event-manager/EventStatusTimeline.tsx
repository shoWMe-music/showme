import { cn } from "@/lib/utils";
import type { EventStatus, Event } from "@/lib/models";
import { isShowDay } from "@/lib/eventLifecycle";

const STEPS: EventStatus[] = ["draft", "suggested", "on_hold", "pending", "confirmed", "concluded", "cancelled"];

const STEP_COLORS: Record<EventStatus, string> = {
  draft: "bg-[hsl(var(--event-draft))]",
  suggested: "bg-[hsl(var(--event-suggested))]",
  pending: "bg-[hsl(var(--event-pending))]",
  confirmed: "bg-[hsl(var(--event-confirmed))]",
  on_hold: "bg-[hsl(var(--event-on-hold))]",
  concluded: "bg-[hsl(var(--event-concluded))]",
  cancelled: "bg-[hsl(var(--event-cancelled))]",
};

const LABELS: Record<EventStatus, string> = {
  draft: "Draft", suggested: "Suggested", pending: "Pending", confirmed: "Confirmed",
  on_hold: "On Hold", concluded: "Concluded", cancelled: "Cancelled",
};

export function EventStatusTimeline({
  status,
  event,
}: {
  status: EventStatus;
  event?: Pick<Event, "eventStatus" | "date">;
}) {
  const showDay = !!event && isShowDay(event);
  const steps = STEPS.filter(s =>
    s !== "cancelled" &&
    (s !== "on_hold" || status === "on_hold") &&
    (s !== "draft" || status === "draft")
  );
  const currentIdx = steps.indexOf(status);

  return (
    <div className="mt-6 flex items-center gap-1">
      {steps.map((step, i) => {
        const isActive = i <= currentIdx && status !== "cancelled";
        const isCurrent = step === status;
        const isShowDayStep = isCurrent && step === "confirmed" && showDay;
        return (
          <div key={step} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={cn(
                "relative h-3 w-3 rounded-full border-2 transition-colors",
                isActive ? `${STEP_COLORS[step]} border-transparent` : "bg-muted border-border",
                isCurrent && !isShowDayStep && "ring-2 ring-offset-2 ring-primary",
                isShowDayStep && "bg-amber-400 ring-2 ring-offset-2 ring-amber-400",
              )}
              style={isShowDayStep ? { boxShadow: "0 0 12px rgba(251,191,36,0.7)" } : undefined}
              >
                {isShowDayStep && (
                  <span className="absolute -inset-1 rounded-full ring-2 ring-amber-400/60 animate-ping" />
                )}
              </div>
              <span className={cn(
                "text-[10px] mt-1 font-medium",
                isShowDayStep ? "text-amber-600 dark:text-amber-400" : isCurrent ? "text-foreground" : "text-muted-foreground"
              )}>
                {isShowDayStep ? "Show day" : LABELS[step]}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-0.5 flex-1 -mt-4", i < currentIdx && status !== "cancelled" ? "bg-primary/40" : "bg-border")} />
            )}
          </div>
        );
      })}
      {status === "cancelled" && (
        <div className="flex flex-col items-center ml-2">
          <div className={cn("h-3 w-3 rounded-full ring-2 ring-offset-2 ring-destructive", STEP_COLORS.cancelled)} />
          <span className="text-[10px] mt-1 font-medium text-destructive">Cancelled</span>
        </div>
      )}
    </div>
  );
}
