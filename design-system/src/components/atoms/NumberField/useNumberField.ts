import { type KeyboardEvent, useMemo, useState } from "react";

export interface UseNumberFieldOptions {
  /** `null`/`undefined` means "nothing entered" — NOT zero. */
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** Fired on blur and on Enter with the settled, clamped value. */
  onCommit?: (value: number | null) => void;
  min?: number;
  max?: number;
  step: number;
  decimals: number;
  allowNegative: boolean;
}

/** Text for a value. The empty string is reserved for "nothing entered", so a
 * value of `0` formats as `"0"` and only `null`/`undefined` formats as `""`. */
export function formatNumberFieldValue(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? "" : String(value);
}

/** The inverse: `""` (and any half-typed fragment such as `"-"` or `"."`)
 * parses to `null`, because none of them is a number the caller can store. */
export function parseNumberFieldText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAcceptedPattern(decimals: number, allowNegative: boolean): RegExp {
  const sign = allowNegative ? "-?" : "";
  const fraction = decimals > 0 ? `(\\.\\d{0,${decimals}})?` : "";
  return new RegExp(`^${sign}\\d*${fraction}$`);
}

/**
 * The state machine behind `NumberField`.
 *
 * It keeps a *text* buffer next to the numeric prop so the two states the
 * caller cares about stay distinguishable: an empty buffer is "nothing
 * entered" (`null`) and `"0"` is the number zero. It also lets half-typed
 * fragments (`"-"`, `"1."`, `"0."`) survive keystrokes instead of being
 * rounded, re-formatted, or reset to `0` under the user's cursor.
 *
 * The buffer re-syncs from the prop only when the prop genuinely changes to
 * something the buffer does not already represent, so the field stays a
 * controlled input without stealing the caret.
 */
export function useNumberField({
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  decimals,
  allowNegative,
}: UseNumberFieldOptions) {
  const normalizedValue = value == null || Number.isNaN(value) ? null : value;
  const accepted = useMemo(
    () => buildAcceptedPattern(decimals, allowNegative),
    [decimals, allowNegative],
  );

  const [text, setText] = useState(() => formatNumberFieldValue(normalizedValue));
  const [syncedValue, setSyncedValue] = useState<number | null>(normalizedValue);

  // Adjust state during render (React's "derive from props" escape hatch) so a
  // parent-driven change lands immediately, while a value the buffer already
  // spells out — `"1."` for `1`, `"007"` for `7` — is left alone.
  if (normalizedValue !== syncedValue) {
    setSyncedValue(normalizedValue);
    if (parseNumberFieldText(text) !== normalizedValue) {
      setText(formatNumberFieldValue(normalizedValue));
    }
  }

  const clamp = (candidate: number | null): number | null => {
    if (candidate == null) return null;
    if (min != null && candidate < min) return min;
    if (max != null && candidate > max) return max;
    return candidate;
  };

  const publish = (nextText: string, nextValue: number | null) => {
    setText(nextText);
    setSyncedValue(nextValue);
    onChange(nextValue);
  };

  /** Rejects keystrokes that would not spell a number, so junk never reaches
   * the buffer and the field never has to "recover" by falling back to zero. */
  const handleChange = (raw: string) => {
    const candidate = raw.replace(",", ".");
    if (!accepted.test(candidate)) return;
    publish(candidate, parseNumberFieldText(candidate));
  };

  /** Settle the buffer: clamp, drop leading zeros and dangling separators. */
  const settle = () => {
    const parsed = parseNumberFieldText(text);
    const clamped = clamp(parsed);
    const settledText = formatNumberFieldValue(clamped);
    setText(settledText);
    setSyncedValue(clamped);
    if (clamped !== parsed) onChange(clamped);
    onCommit?.(clamped);
  };

  /** Arrow-key stepping, which a plain text input does not get for free — it is
   * what makes the control a real `spinbutton` for keyboard users. */
  const stepBy = (direction: 1 | -1) => {
    const current = parseNumberFieldText(text);
    const base = current ?? clamp(0) ?? 0;
    const next = current == null ? base : Number((base + step * direction).toFixed(decimals));
    const clamped = clamp(next);
    publish(formatNumberFieldValue(clamped), clamped);
  };

  const handleKeyDown = (keyEvent: KeyboardEvent<HTMLInputElement>) => {
    if (keyEvent.key === "ArrowUp") {
      keyEvent.preventDefault();
      stepBy(1);
    } else if (keyEvent.key === "ArrowDown") {
      keyEvent.preventDefault();
      stepBy(-1);
    } else if (keyEvent.key === "Enter") {
      settle();
    }
  };

  return { text, isEmpty: text === "", handleChange, handleKeyDown, settle };
}
