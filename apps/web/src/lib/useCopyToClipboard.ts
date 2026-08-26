import { useToast } from "@showme/design-system";
import { useCallback, useRef, useState } from "react";

/** How long a field shows "Copied" before returning to its idle state. */
const COPIED_FEEDBACK_MILLISECONDS = 1600;

export interface ClipboardCopier {
  /** The value most recently copied, or null — for per-field "Copied" feedback. */
  copiedValue: string | null;
  copy: (value: string, label: string) => Promise<void>;
}

/**
 * Copy a value to the clipboard and say so.
 *
 * Three call sites already wrote their own version of this before it existed
 * (`EventPublishPanel`, `useShareExport`, `useAvailabilityShare`); this is the
 * shared one. They are other agents' files at the moment and are left alone —
 * adopting it there is a follow-up, not a reason to hold this up.
 *
 * `navigator.clipboard` is unavailable on an insecure origin and can be refused
 * by permission policy, so the failure path is real rather than theoretical: it
 * reports the failure instead of leaving someone believing they have a value
 * they do not. There is no `document.execCommand` fallback on purpose — it is
 * deprecated, and a silent half-working copy is worse than an honest refusal.
 */
export function useCopyToClipboard(): ClipboardCopier {
  const toast = useToast();
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopiedValue(value);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopiedValue(null), COPIED_FEEDBACK_MILLISECONDS);
        toast.success(`${label} copied`);
      } catch {
        // Naming the field matters: the person is mid-task with a payment page
        // open in another tab, and needs to know THIS value did not arrive.
        toast.error(`Couldn't copy the ${label.toLowerCase()} — select it and copy manually.`);
      }
    },
    [toast],
  );

  return { copiedValue, copy };
}
