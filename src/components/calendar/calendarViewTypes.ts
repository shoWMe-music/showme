import { CalendarItem, type Event as AppEvent } from "@/lib/models";
import { PopupItemType } from "./calendarConstants";

/** Shared prop shape passed to all three calendar grid views */
export interface CalendarViewSharedProps {
  /** Map of dateKey -> events */
  eventsByDate: Map<string, AppEvent[]>;
  /** Map of dateKey -> CalendarItems */
  calItemsByDate: Map<string, CalendarItem[]>;
  /** All calendar items (needed for week all-day row filtering) */
  calendarItems: CalendarItem[];
  /** Map of parentEventId -> the parent (multi-performer) event */
  parentEventMap: Map<string, AppEvent>;
  /** Set of dateKey strings that are unavailable */
  flatCombinedUnavailable: Set<string>;
  /** Currently dragged-over drop target key */
  dragOverTarget: string | null;
  /** Whether the user is in marking mode */
  markingMode: boolean;
  /** Chip renderer for CalendarItems */
  renderCalItemChip: (ci: CalendarItem, sizeClass: string, showTime?: boolean) => React.ReactNode;
  /** Chip renderer for Events. Pass `labelOverride` to force a specific label (e.g. parent festival name). */
  renderEventChip: (event: AppEvent, sizeClass: string, labelOverride?: string) => React.ReactNode;
  /** Get entity color for an event */
  getEventEntityColor: (event: AppEvent) => string | undefined;
  /** Fired when a grid cell is clicked */
  onCellClick: (day: Date, e: React.MouseEvent) => void;
  /** Fired when an hour cell is clicked (week/day views) */
  onHourCellClick: (day: Date, hour: number, e: React.MouseEvent) => void;
  /** Fired when an item (event or calItem) is clicked */
  onItemClick: (item: PopupItemType, e: React.MouseEvent) => void;
  /** Drag handlers */
  onDragOver: (e: React.DragEvent, targetKey: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, dateKey: string, hour?: number) => void;
  onWeekAllDayDrop: (e: React.DragEvent, dateKey: string) => void;
  /** Hours array [6..23] */
  hours: number[];
}
