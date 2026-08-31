import type { InputHTMLAttributes, ReactNode } from "react";
import { useId, useRef } from "react";
import { Icon } from "@/icons";
import { classNames } from "@/lib/classNames";
import styles from "./TagInput.module.css";
import { useTagInput } from "./useTagInput";

export interface TagInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "onPaste" | "type"
  > {
  /** Mono uppercase label rendered above the field (matches TextField). */
  label?: ReactNode;
  /** The committed tags, in the user's own order. */
  value: readonly string[];
  /** Fired with the whole next list on every add and every remove. */
  onChange: (next: string[]) => void;
  /** Cap on how many tags may be added. The box hides once it is reached. */
  maxTags?: number;
  /** Cap on one tag's length. */
  maxTagLength?: number;
  /** Small line under the field — what to type, or why the box went away. */
  hint?: ReactNode;
  className?: string;
}

/**
 * A list of short free-text values, entered one at a time as removable pills.
 *
 * It exists because the alternative in this app was a `TextField` labelled
 * "Genres (comma-separated)" whose value was `split(",")` on save. That is a
 * text box wearing a data structure as a hat: nothing shows what has been
 * entered, "Indie,Rock" and "Indie, Rock" store differently, a stray trailing
 * comma stores an empty genre, and removing the middle item means editing a
 * string by hand. None of that is specific to genres — the same shape is wanted
 * for amenities, tags and keywords — so the control belongs here rather than in
 * one screen.
 *
 * Committing is deliberately forgiving: Enter, comma, Tab and blur all end a
 * tag, and pasting a comma-separated list becomes a row of pills, because the
 * habit this replaces IS typing commas.
 *
 * The frame is the same fill / hairline / 10px radius as `TextField` and
 * `NumberField`, and the pills wrap inside it, so a long list grows the field
 * downwards. Nothing here scrolls sideways at any width.
 */
export function TagInput({
  label,
  value,
  onChange,
  maxTags,
  maxTagLength,
  hint,
  id,
  className,
  disabled,
  placeholder,
  onBlur,
  onKeyDown,
  ...rest
}: TagInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const { draft, setDraft, isFull, commitDraft, removeAt, handleKeyDown, handlePaste } =
    useTagInput({ value, onChange, maxTags, maxTagLength });

  return (
    <div className={classNames(styles.field, className)}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      )}
      {/* The frame carries the click, not just the input: the box is mostly
          pills, so a tap on the empty space beside them has to put the caret in
          the field or the control feels dead. It is not a button — a button
          here would swallow the pills' own remove buttons. */}
      <div
        className={classNames(styles.control, disabled && styles.controlDisabled)}
        onMouseDown={(mouseEvent) => {
          if (disabled || mouseEvent.target !== mouseEvent.currentTarget) return;
          mouseEvent.preventDefault();
          inputRef.current?.focus();
        }}
        role="presentation"
      >
        {value.map((tag, index) => (
          <span key={tag} className={classNames(styles.pill, disabled && styles.pillPlain)}>
            <span className={styles.pillLabel}>{tag}</span>
            {!disabled && (
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${tag}`}
                onClick={() => removeAt(index)}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
        ))}

        {!isFull && (
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="off"
            className={styles.input}
            // The box is one field among many pills, so it has to say what it is
            // for on its own. Named after the label when there is one.
            aria-label={rest["aria-label"] ?? (typeof label === "string" ? label : undefined)}
            value={draft}
            placeholder={value.length === 0 ? placeholder : undefined}
            disabled={disabled}
            onChange={(changeEvent) => setDraft(changeEvent.target.value)}
            onPaste={handlePaste}
            onKeyDown={(keyEvent) => {
              handleKeyDown(keyEvent);
              onKeyDown?.(keyEvent);
            }}
            // Blur commits. Without this, typing a tag and pressing Save loses
            // it — the click lands on the button before any Enter is pressed,
            // which is exactly how a half-typed list gets saved short.
            onBlur={(focusEvent) => {
              commitDraft();
              onBlur?.(focusEvent);
            }}
            {...rest}
          />
        )}
      </div>
      {(hint || isFull) && (
        <p className={styles.hint}>{isFull ? `That's the maximum of ${maxTags}.` : hint}</p>
      )}
    </div>
  );
}
