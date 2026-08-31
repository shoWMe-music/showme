import { type ClipboardEvent, type KeyboardEvent, useState } from "react";

export interface UseTagInputOptions {
  /** The committed tags. Order is the user's; this never sorts. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Cap on how many tags may be committed. Unset means no cap. */
  maxTags?: number;
  /** Cap on one tag's length, applied when it is committed. Unset means none. */
  maxTagLength?: number;
}

/** The keys that end a tag. Comma is here because a comma-separated list is what
 * everyone types out of habit — including into the box this control replaces —
 * and Tab because leaving the field mid-word should keep the word, not the caret. */
const COMMIT_KEYS = ["Enter", ",", "Tab"];

/** The separators that end a tag inside a block of text — a comma-separated
 * list, a newline-separated one, or a single value. Semicolons come along
 * because spreadsheets export them. Used both for a paste and for settling the
 * draft, so text that arrives all at once obeys the same rule as text typed. */
function splitOnSeparators(text: string): string[] {
  return text.split(/[,;\n\r\t]+/);
}

/**
 * The state machine behind `TagInput`.
 *
 * The one rule that decides everything else: **a tag is committed, or it is
 * draft text — never both.** The draft lives here rather than in `value`, so the
 * parent's array only ever holds tags the user finished typing, and a form that
 * saves mid-keystroke cannot store half a word.
 *
 * Duplicates are rejected case-INSENSITIVELY but the first spelling is kept.
 * "Techno" then "techno" is one tag, spelled the way it was first typed; two
 * pills that differ only in case read as a bug, and the stored value is a label
 * a person reads, not a key anything joins on.
 */
export function useTagInput({ value, onChange, maxTags, maxTagLength }: UseTagInputOptions) {
  const [draft, setDraft] = useState("");

  const isFull = maxTags != null && value.length >= maxTags;

  const normalize = (candidate: string): string => {
    const trimmed = candidate.trim().replace(/\s+/g, " ");
    return maxTagLength != null ? trimmed.slice(0, maxTagLength) : trimmed;
  };

  /** Add every candidate that survives trimming, the cap and the duplicate test.
   * Returns whether anything was actually added, so the caller knows whether to
   * clear the draft it came from. */
  const addMany = (candidates: readonly string[]): boolean => {
    const next = [...value];
    let added = false;
    for (const candidate of candidates) {
      const tag = normalize(candidate);
      if (tag === "") continue;
      if (maxTags != null && next.length >= maxTags) break;
      if (next.some((existing) => existing.toLowerCase() === tag.toLowerCase())) continue;
      next.push(tag);
      added = true;
    }
    if (added) onChange(next);
    return added;
  };

  /**
   * Commit whatever is in the draft.
   *
   * SPLIT, don't take the box as one value — found by driving the field. A
   * separator only reaches `handleKeyDown` when it was TYPED, and there are
   * several ordinary ways for text to arrive in an input without keystrokes:
   * autofill, an IME or speech composition, a browser restoring a form, a test
   * calling `fill()`. Committing "Indie, Folk, Post-Rock" as a single tag in
   * those cases is exactly the mess this control replaces, one pill deep.
   * Splitting here means the separator rule holds however the text got in.
   *
   * A duplicate still clears the box — the tag the user asked for IS on screen,
   * so leaving the text behind reads as the control having ignored them.
   */
  const commitDraft = (): void => {
    if (normalize(draft) !== "") addMany(splitOnSeparators(draft));
    setDraft("");
  };

  const removeAt = (index: number): void => {
    onChange(value.filter((_, position) => position !== index));
  };

  const handleKeyDown = (keyEvent: KeyboardEvent<HTMLInputElement>): void => {
    if (COMMIT_KEYS.includes(keyEvent.key)) {
      // Tab with an empty box must still move focus — trapping the caret in a
      // field the user is trying to leave is worse than losing nothing.
      if (keyEvent.key === "Tab" && normalize(draft) === "") return;
      keyEvent.preventDefault();
      commitDraft();
      return;
    }
    // Backspace on an empty box takes the last pill back, the way every tag
    // field a person has used before does. Only on an empty box: mid-word it
    // must delete a character.
    if (keyEvent.key === "Backspace" && draft === "" && value.length > 0) {
      keyEvent.preventDefault();
      removeAt(value.length - 1);
    }
  };

  /**
   * Pasting a comma-separated list makes it a row of pills rather than one
   * absurd pill. This matters more than it sounds: the field this control
   * replaces was a comma-separated text box, so the first thing anyone with an
   * existing list will do is paste it in.
   */
  const handlePaste = (pasteEvent: ClipboardEvent<HTMLInputElement>): void => {
    const text = pasteEvent.clipboardData.getData("text");
    if (!/[,;\n\r\t]/.test(text)) return; // a single value — let the input have it
    pasteEvent.preventDefault();
    addMany(splitOnSeparators(text));
    setDraft("");
  };

  return { draft, setDraft, isFull, commitDraft, removeAt, handleKeyDown, handlePaste };
}
