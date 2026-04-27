import { format } from "date-fns";
import {
  Calendar as CalendarIcon, CheckSquare, Clock, StickyNote, Ban,
} from "lucide-react";
import { CalendarItemType } from "@/lib/models";

interface CalendarQuickCreateMenuProps {
  quickCreateDate: Date;
  quickCreatePos: { x: number; y: number };
  quickCreateTime?: string;
  onQuickCreate: (type: "event" | "hold" | CalendarItemType) => void;
  onClose: () => void;
}

export function CalendarQuickCreateMenu({
  quickCreateDate,
  quickCreatePos,
  quickCreateTime,
  onQuickCreate,
  onClose,
}: CalendarQuickCreateMenuProps) {
  return (
    <div
      className="fixed z-[90]"
      style={{ left: Math.min(quickCreatePos.x, window.innerWidth - 200), top: Math.min(quickCreatePos.y, window.innerHeight - 220) }}
    >
      <div
        className="rounded-lg border bg-popover shadow-lg p-2 w-44 animate-in fade-in-0 zoom-in-95"
        ref={(el) => {
          if (!el) return;
          const handler = (e: MouseEvent) => { if (!el.contains(e.target as Node)) onClose(); };
          document.addEventListener("mousedown", handler, { once: true });
        }}
      >
        <p className="text-[10px] uppercase font-medium text-muted-foreground px-2 py-1">
          {format(quickCreateDate, "MMM d")}{quickCreateTime ? ` ${quickCreateTime}` : ""} — Create
        </p>
        {([
          { key: "event" as const, icon: <CalendarIcon className="h-4 w-4" />, label: "Event" },
          { key: "hold" as const, icon: <Ban className="h-4 w-4" />, label: "Hold" },
          { key: "task" as const, icon: <CheckSquare className="h-4 w-4" />, label: "Task" },
          { key: "appointment" as const, icon: <Clock className="h-4 w-4" />, label: "Appointment" },
          { key: "note" as const, icon: <StickyNote className="h-4 w-4" />, label: "Note" },
        ] as const).map(opt => (
          <button
            key={opt.key}
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left"
            onClick={(e) => { e.stopPropagation(); onQuickCreate(opt.key); }}
          >
            {opt.icon}{opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
