import type { Contact, ContactType } from "@/lib/models";

/** Check if a contact has a given type (supports array or single type). */
export function contactHasType(contact: Pick<Contact, "type">, type: ContactType): boolean {
  return Array.isArray(contact.type) ? contact.type.includes(type) : contact.type === type;
}

/** Get the primary (first) type of a contact. */
export function contactPrimaryType(contact: Pick<Contact, "type">): ContactType {
  return Array.isArray(contact.type) ? contact.type[0] : contact.type;
}

/** Check if a contact name matches any of the user's own profile names. */
export function isOwnProfileName(name: string, profileNames: string[]): boolean {
  if (!name.trim()) return false;
  return profileNames.some(pn => pn.toLowerCase() === name.trim().toLowerCase());
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
