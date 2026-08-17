import { Button, Checkbox, Icon, Input, Modal, Select } from "@showme/design-system";
import type { ReactNode } from "react";
import { Eyebrow } from "./primitives";

/** The Check & Share Availability modal (§2, shot 02). Presentational shell over
 * the DS `Modal`: every field is controlled and the computed available dates +
 * share link are supplied by the screen. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Sentence-case field label (Calendar / From / To) — the design uses these for
 * inputs, and reserves the uppercase `Eyebrow` for section headers. */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{children}</span>
  );
}

export interface AvailabilityShareModalProps {
  open: boolean;
  onClose: () => void;
  calendars: string[];
  calendar: string;
  onCalendarChange?: (calendar: string) => void;
  from: string;
  to: string;
  onFromChange?: (value: string) => void;
  onToChange?: (value: string) => void;
  showConfirmed: boolean;
  onShowConfirmedChange?: (next: boolean) => void;
  showHeld: boolean;
  onShowHeldChange?: (next: boolean) => void;
  /** Selected weekday indices, Monday = 0 … Sunday = 6. */
  selectedWeekdays: number[];
  onToggleWeekday?: (index: number) => void;
  /** Pre-formatted available-date labels, e.g. "Fri · Jul 11". */
  availableDates: string[];
  onCopyDates?: () => void;
  shareLink: string;
  onCopyLink?: () => void;
  helperText?: string;
}

export function AvailabilityShareModal({
  open,
  onClose,
  calendars,
  calendar,
  onCalendarChange,
  from,
  to,
  onFromChange,
  onToChange,
  showConfirmed,
  onShowConfirmedChange,
  showHeld,
  onShowHeldChange,
  selectedWeekdays,
  onToggleWeekday,
  availableDates,
  onCopyDates,
  shareLink,
  onCopyLink,
  helperText = "Availabilities may change. This link reflects availability as of when it was generated.",
}: AvailabilityShareModalProps) {
  const selected = new Set(selectedWeekdays);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Check & Share Availability"
      width={560}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldLabel>Calendar</FieldLabel>
          <Select
            value={calendar}
            onChange={(value) => onCalendarChange?.(value)}
            options={calendars}
            aria-label="Calendar"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <FieldLabel>From</FieldLabel>
            <Input
              type="date"
              value={from}
              onChange={(event) => onFromChange?.(event.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <FieldLabel>To</FieldLabel>
            <Input type="date" value={to} onChange={(event) => onToChange?.(event.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Show as unavailable</Eyebrow>
          <Checkbox
            checked={showConfirmed}
            onChange={onShowConfirmedChange}
            tone="brand"
            label="Confirmed events"
          />
          <Checkbox
            checked={showHeld}
            onChange={onShowHeldChange}
            tone="brand"
            label="Held events"
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Days of the week</Eyebrow>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {WEEKDAYS.map((day, index) => {
              const active = selected.has(index);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToggleWeekday?.(index)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: active ? "none" : "1px solid var(--border)",
                    background: active ? "var(--brand-red)" : "transparent",
                    color: active ? "#fff" : "var(--muted)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Available dates in range</Eyebrow>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: 12,
              borderRadius: 12,
              background: "var(--elevated)",
              border: "1px solid var(--border)",
            }}
          >
            {availableDates.length === 0 ? (
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                No available dates in range.
              </span>
            ) : (
              availableDates.map((date) => (
                <span
                  key={date}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                >
                  {date}
                </span>
              ))
            )}
          </div>
          {onCopyDates && (
            <button
              type="button"
              onClick={onCopyDates}
              style={{
                alignSelf: "flex-end",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "none",
                background: "transparent",
                color: "var(--brand-red)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                padding: 0,
              }}
            >
              <Icon name="copy" size={14} />
              Copy dates
            </button>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Shareable link</Eyebrow>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <Input value={shareLink} readOnly leftIcon={<Icon name="link" size={14} />} />
            </div>
            {onCopyLink && (
              <Button
                variant="secondary"
                leftIcon={<Icon name="copy" size={14} />}
                onClick={onCopyLink}
              >
                Copy
              </Button>
            )}
          </div>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>{helperText}</span>
        </div>
      </div>
    </Modal>
  );
}
