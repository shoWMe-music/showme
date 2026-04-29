import type { Contact, ContactType } from "@/lib/models";

/**
 * Normalize a contact type, mapping legacy values to current names.
 * - "artist" (legacy) → "performer"
 * Returns the input unchanged for any other value.
 */
export function normalizeContactType(type: ContactType): ContactType {
  return type === "artist" ? "performer" : type;
}

/** Get the contact's types as an array, with legacy values normalized. */
export function contactTypeList(contact: Pick<Contact, "type">): ContactType[] {
  const raw = Array.isArray(contact.type) ? contact.type : [contact.type];
  return raw.map(normalizeContactType);
}

/** Check if a contact has a given type (supports array or single type, normalizes legacy). */
export function contactHasType(contact: Pick<Contact, "type">, type: ContactType): boolean {
  const target = normalizeContactType(type);
  return contactTypeList(contact).includes(target);
}

/** Get the primary (first) type of a contact, with legacy values normalized. */
export function contactPrimaryType(contact: Pick<Contact, "type">): ContactType {
  return contactTypeList(contact)[0];
}

/** Check if a contact name matches any of the user's own profile names. */
export function isOwnProfileName(name: string, profileNames: string[]): boolean {
  if (!name.trim()) return false;
  return profileNames.some(pn => pn.toLowerCase() === name.trim().toLowerCase());
}

/**
 * Split imported contact rows into those that should be persisted (`kept`)
 * and those that match one of the user's own profile names (`skipped`).
 * Contacts are external only — never auto-create a contact for the user's
 * own venue/performer/promoter profile during a CSV bulk import.
 */
export function partitionImportedByOwnProfile<T extends { name: string }>(
  imported: T[],
  profileNames: string[],
): { kept: T[]; skipped: T[] } {
  const kept: T[] = [];
  const skipped: T[] = [];
  for (const row of imported) {
    if (isOwnProfileName(row.name, profileNames)) skipped.push(row);
    else kept.push(row);
  }
  return { kept, skipped };
}

/** Check if a contact already exists by name and type (supports array types). */
export function contactExists(
  contacts: Pick<Contact, "name" | "type">[],
  name: string,
  type: ContactType,
): boolean {
  return contacts.some(
    c => c.name.toLowerCase() === name.toLowerCase() && contactHasType(c, type),
  );
}

/**
 * Group a list of contacts by type. A contact with multiple types appears in
 * each of its groups. Legacy "artist" types are normalized to "performer".
 */
export function groupContactsByType<T extends Pick<Contact, "type">>(
  contacts: T[],
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const c of contacts) {
    for (const t of contactTypeList(c)) {
      if (!groups[t]) groups[t] = [];
      groups[t].push(c);
    }
  }
  return groups;
}
