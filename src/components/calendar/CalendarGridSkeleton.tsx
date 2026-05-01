import { Fragment } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ViewMode } from "./calendarConstants";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

interface CalendarGridSkeletonProps {
  viewMode: ViewMode;
  cellCount?: number;
}

export function CalendarGridSkeleton({ viewMode, cellCount = 42 }: CalendarGridSkeletonProps) {
  if (viewMode === "month") {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
          {WEEK_DAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center">{d}</div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7 grid-rows-6">
          {Array.from({ length: cellCount }).map((_, i) => {
            const chips = (i * 7919) % 4;
            return (
              <div key={i} className="border-b border-r p-1.5 space-y-1.5">
                <Skeleton className="h-3 w-5" />
                {Array.from({ length: chips }).map((_, j) => (
                  <Skeleton key={j} className="h-3.5 w-full" />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (viewMode === "week") {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b text-xs font-medium text-muted-foreground">
          <div />
          {WEEK_DAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center">{d}</div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-[60px_repeat(7,1fr)]">
          {HOURS.slice(0, 12).map((h) => (
            <Fragment key={`row-${h}`}>
              <div className="border-b border-r px-2 py-3 text-[10px] text-muted-foreground">
                {h}:00
              </div>
              {Array.from({ length: 7 }).map((_, c) => {
                const showChip = (h + c) % 5 === 0;
                return (
                  <div key={`cell-${h}-${c}`} className="border-b border-r p-1.5">
                    {showChip && <Skeleton className="h-4 w-full" />}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid flex-1 grid-cols-[60px_1fr]">
        {HOURS.map((h) => (
          <Fragment key={`row-${h}`}>
            <div className="border-b border-r px-2 py-3 text-[10px] text-muted-foreground">
              {h}:00
            </div>
            <div className="border-b border-r p-1.5">
              {h % 4 === 0 && <Skeleton className="h-5 w-2/3" />}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
