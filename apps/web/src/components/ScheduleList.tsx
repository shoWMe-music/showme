import { ListRow } from "@showme/design-system";

/** The production-schedule rows on the Agreement tab (§3b): a mono time in the
 * leading slot + a label. Thin wrapper over `ListRow`. Presentational. */
export interface ScheduleEntry {
  /** Pre-formatted time, e.g. "15:00". */
  time: string;
  label: string;
}

export interface ScheduleListProps {
  entries: ScheduleEntry[];
}

export function ScheduleList({ entries }: ScheduleListProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {entries.map((entry) => (
        <ListRow
          key={`${entry.time}-${entry.label}`}
          leading={
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--accent)",
                minWidth: 48,
              }}
            >
              {entry.time}
            </span>
          }
          title={entry.label}
        />
      ))}
    </div>
  );
}
