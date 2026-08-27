import { useCallback, useRef, useState } from "react";

/**
 * Click-and-drag selection across a seven-column grid of day cells — the gesture
 * behind marking mode, shared by the month grid and the week grid so the two
 * cannot drift apart.
 *
 * WHY A RECTANGLE AND NOT A RUN OF DAYS. Dragging from the 3rd to the 19th
 * across a month could mean "every night in between" (a run) or "those weekday
 * columns for those weeks" (a rectangle). A calendar is laid out as a table, and
 * a pointer sweeping over a table selects the block it sweeps — the rectangle is
 * what the reader watches themselves draw. The week grid is a single row, where
 * the two readings coincide.
 *
 * The drag itself lives in refs, not state: the commit on mouse-up has to see
 * the final cell, and a state update queued by the last `mouseenter` would not
 * have landed yet. State carries only what has to repaint — the highlight.
 */

/** Both grids are seven columns wide (Monday-first weeks). */
const COLUMNS = 7;

function isInRectangle(index: number, start: number, end: number): boolean {
  const row = Math.floor(index / COLUMNS);
  const column = index % COLUMNS;
  const startRow = Math.floor(start / COLUMNS);
  const startColumn = start % COLUMNS;
  const endRow = Math.floor(end / COLUMNS);
  const endColumn = end % COLUMNS;
  return (
    row >= Math.min(startRow, endRow) &&
    row <= Math.max(startRow, endRow) &&
    column >= Math.min(startColumn, endColumn) &&
    column <= Math.max(startColumn, endColumn)
  );
}

export interface DayCellSelection {
  /** Whether the cell at `index` is under the drag being drawn right now. */
  isInDrag: (index: number) => boolean;
  /** Spread onto each day cell. Empty when marking is off, so a normal calendar
   * keeps exactly the handlers it had. */
  cellProps: (index: number) => {
    onMouseDown?: (event: React.MouseEvent) => void;
    onMouseEnter?: () => void;
  };
  /** Spread onto the element wrapping the cells — a drag has to end even if the
   * pointer leaves the grid, or the highlight sticks to nothing. */
  containerProps: {
    onMouseUp?: () => void;
    onMouseLeave?: () => void;
  };
}

/**
 * @param dayKeys One entry per grid cell, in reading order. `null` for a cell
 *   that cannot be marked (a month grid's spill days), which the rectangle
 *   sweeps over but never reports.
 */
export function useDayCellSelection(
  dayKeys: (string | null)[],
  enabled: boolean,
  onMarkDays?: (days: string[], modifiers?: { shiftKey?: boolean }) => void,
): DayCellSelection {
  const startIndex = useRef<number | null>(null);
  const endIndex = useRef<number | null>(null);
  const shiftHeld = useRef(false);
  const [dragRectangle, setDragRectangle] = useState<{ start: number; end: number } | null>(null);

  const commit = useCallback(() => {
    const start = startIndex.current;
    const end = endIndex.current;
    startIndex.current = null;
    endIndex.current = null;
    setDragRectangle(null);
    if (start === null || end === null || !onMarkDays) return;

    if (start === end) {
      const day = dayKeys[start];
      // A plain click reports ONE day and carries the modifier, so the caller can
      // read it as a toggle or as a shift-extended range.
      if (day) onMarkDays([day], { shiftKey: shiftHeld.current });
      return;
    }
    const days = dayKeys.filter(
      (day, index): day is string => day !== null && isInRectangle(index, start, end),
    );
    if (days.length > 0) onMarkDays(days);
  }, [dayKeys, onMarkDays]);

  return {
    isInDrag: (index) =>
      dragRectangle !== null && isInRectangle(index, dragRectangle.start, dragRectangle.end),
    cellProps: (index) =>
      enabled
        ? {
            onMouseDown: (event) => {
              // Without this the browser starts a text selection and the grid
              // fills with blue as the pointer sweeps.
              event.preventDefault();
              startIndex.current = index;
              endIndex.current = index;
              shiftHeld.current = event.shiftKey;
              setDragRectangle({ start: index, end: index });
            },
            onMouseEnter: () => {
              if (startIndex.current === null) return;
              endIndex.current = index;
              setDragRectangle({ start: startIndex.current, end: index });
            },
          }
        : {},
    containerProps: enabled ? { onMouseUp: commit, onMouseLeave: commit } : {},
  };
}
