/**
 * CSV export for the Contacts page (Wave 7 B4).
 *
 * Pure helpers — no DOM, no toast — so the row builder can be unit-tested
 * in isolation. The download trigger lives in the dialog component which
 * mirrors the Blob + URL.createObjectURL pattern from
 * `src/components/BudgetExportActions.tsx:73-104`.
 *
 * Columns (this wave): name, type(s), emails, phone, IBAN, bank, VAT,
 * address, notes. Multi-value fields (emails, phones, types) are
 * semicolon-joined inside a single CSV cell.
 */

import type { Contact } from "@/lib/models";
import { contactTypeList } from "@/lib/contacts";

/** Header row used for both file output and consumer parsing tests. */
export const CONTACT_CSV_HEADERS = [
  "Name",
  "Type(s)",
  "Emails",
  "Phones",
  "IBAN",
  "Bank Name",
  "VAT / Tax ID",
  "Address",
  "Notes",
] as const;

/**
 * Convert a single Contact into one CSV row (string[]). Multi-value fields
 * (types, emails, phones) are joined with "; " inside a cell so the CSV
 * stays one-row-per-contact.
 */
export function contactToCsvRow(contact: Contact): string[] {
  const types = contactTypeList(contact);
  const emails = contact.contacts
    .map(c => c.email?.trim())
    .filter((e): e is string => !!e && e.length > 0);
  const phones = contact.contacts
    .map(c => c.phone?.trim())
    .filter((p): p is string => !!p && p.length > 0);

  return [
    contact.name ?? "",
    types.join("; "),
    emails.join("; "),
    phones.join("; "),
    contact.iban ?? "",
    contact.bankName ?? "",
    contact.vatId ?? "",
    contact.address ?? "",
    contact.notes ?? "",
  ];
}

/**
 * Quote a single CSV cell. Wraps every value in double quotes and escapes
 * embedded double quotes per RFC 4180 (the BudgetExportActions reference
 * doesn't escape — but contact notes can contain quotes/commas/newlines,
 * so we harden it here).
 */
function quote(cell: string): string {
  return `"${String(cell).replace(/"/g, '""')}"`;
}

/**
 * Build the full CSV string for a given list of contacts. Returns just the
 * file content — the caller is responsible for the Blob + download trigger.
 */
export function buildContactsCsv(contacts: Contact[]): string {
  const rows: string[][] = [
    [...CONTACT_CSV_HEADERS],
    ...contacts.map(contactToCsvRow),
  ];
  return rows.map(r => r.map(quote).join(",")).join("\n");
}

/**
 * Default download filename for a contacts export. Includes today's date in
 * ISO format so successive exports don't collide.
 */
export function buildContactsCsvFilename(now: Date = new Date()): string {
  return `contacts-${now.toISOString().slice(0, 10)}.csv`;
}
