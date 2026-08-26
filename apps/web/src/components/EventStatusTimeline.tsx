import { Icon } from "@showme/design-system";

/** The event status progression rail (§3b): Suggested → Pending → Confirmed →
 * Concluded (or draft → on_hold → …). A themed superset of the DS `Stepper`
 * (which is number-dots only): done stages fill with the brand gradient, the
 * current stage is highlighted, later stages are muted. Presentational. */
export interface EventStatusStage {
  key: string;
  label: string;
}

export interface EventStatusTimelineProps {
  stages: EventStatusStage[];
  /** `key` of the current stage. */
  current: string;
}

export function EventStatusTimeline({ stages, current }: EventStatusTimelineProps) {
  const currentIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.key === current),
  );

  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      {stages.map((stage, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        const dotBackground = isDone
          ? "var(--brand-gold)"
          : isCurrent
            ? "linear-gradient(135deg, var(--brand-red), var(--brand-amber))"
            : "var(--shape-fill)";
        const dotColor = isDone || isCurrent ? "#fff" : "var(--dim)";
        return (
          <div
            key={stage.key}
            style={{
              display: "flex",
              alignItems: "center",
              flex: index === stages.length - 1 ? "0 0 auto" : 1,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: dotBackground,
                  border: isCurrent ? "none" : "1px solid var(--border)",
                  color: dotColor,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {isDone ? <Icon name="check" size={14} /> : index + 1}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: isCurrent ? "var(--text)" : "var(--muted)",
                  fontWeight: isCurrent ? 700 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {stage.label}
              </span>
            </div>
            {index < stages.length - 1 && (
              <span
                style={{
                  flex: 1,
                  height: 2,
                  margin: "0 8px",
                  marginTop: 13,
                  alignSelf: "flex-start",
                  background: index < currentIndex ? "var(--brand-gold)" : "var(--border)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
