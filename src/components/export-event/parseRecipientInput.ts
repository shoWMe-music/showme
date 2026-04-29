/**
 * Parse the "Add recipients" input into a list of valid emails plus a list of
 * invalid candidates. The input can be a single email, or a comma- /
 * semicolon- / whitespace-separated list (typical when users paste a row from
 * a spreadsheet or a contact list). Each candidate is trimmed and lower-cased
 * before validation.
 */
export interface ParsedRecipientInput {
  /** Lower-cased, deduped emails that passed validation. */
  valid: string[];
  /** Original (lower-cased) candidates that failed validation. */
  invalid: string[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipientInput(raw: string): ParsedRecipientInput {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: [], invalid: [] };

  const candidates = trimmed
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];
  for (const c of candidates) {
    if (EMAIL_REGEX.test(c)) {
      if (!valid.includes(c)) valid.push(c);
    } else {
      invalid.push(c);
    }
  }
  return { valid, invalid };
}
