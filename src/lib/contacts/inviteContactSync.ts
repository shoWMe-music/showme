/**
 * Pure helpers for the Wave 7 invitation ↔ contact sync.
 *
 * The cloud function `createInvitationCode` writes both an InvitationCode
 * doc and a matching Contact card in a single transaction. For invitations
 * that pre-date that change (no `linkedContactId`), the client runs a
 * one-time backfill on app load that creates a Contact card for any
 * unlinked code whose recipient doesn't already exist as a contact.
 *
 * Logic is split out from `ContactsPage.tsx` so it can be unit-tested in
 * isolation — no Firestore, no React.
 */

import type { Contact, ContactType } from "@/lib/models";
import type { InvitationCode } from "@/lib/db";

export interface BackfillContactPlan {
  code: InvitationCode;
  contact: Contact;
}

/**
 * Decide which invitation codes need a backfilled Contact card. A code is
 * eligible when:
 *   - it has no `linkedContactId` yet, AND
 *   - it has at least a `recipientName` or `recipientEmail`, AND
 *   - the user has no existing contact whose primary email matches the
 *     invite's recipientEmail (case-insensitive, trimmed).
 *
 * The output Contact ids use the `now`-injected timestamp + a stable
 * suffix per code so the helper is fully deterministic for tests.
 */
export function planInviteContactBackfill(
  codes: InvitationCode[],
  contacts: Pick<Contact, "id" | "name" | "contacts">[],
  now: number = Date.now(),
): BackfillContactPlan[] {
  const plans: BackfillContactPlan[] = [];
  const seenEmails = new Set<string>();
  for (const c of contacts) {
    for (const person of c.contacts ?? []) {
      const email = (person.email ?? "").toLowerCase().trim();
      if (email) seenEmails.add(email);
    }
  }

  let serial = 0;
  for (const code of codes) {
    if (code.linkedContactId) continue;
    if (code.status === "revoked") continue;
    const recipientName = code.recipientName?.trim() ?? "";
    const recipientEmail = (code.recipientEmail ?? "").toLowerCase().trim();
    if (!recipientName && !recipientEmail) continue;
    if (recipientEmail && seenEmails.has(recipientEmail)) continue;

    const id = `P-${now}-${serial.toString(36)}`;
    serial += 1;
    seenEmails.add(recipientEmail);

    const status: NonNullable<Contact["invitationStatus"]> =
      code.status === "used" ? "used"
        : code.status === "accepted" ? "accepted"
          : "active";

    const contact: Contact = {
      id,
      name: recipientName || code.recipientEmail || "Invited collaborator",
      type: "performer" as ContactType,
      contacts: [{
        name: recipientName,
        email: code.recipientEmail ?? "",
        phone: "",
      }],
      iban: "",
      bankName: "",
      vatId: "",
      address: "",
      notes: "",
      invitationCode: code.code,
      invitationStatus: status,
    };
    plans.push({ code, contact });
  }
  return plans;
}

/**
 * Status set considered "active" for the Contacts → Active Collaborators
 * filter. Per Daniel (Wave 7 B1.4) anyone who was ever invited counts —
 * everything except `revoked`.
 */
export const ACTIVE_COLLABORATOR_STATUSES = new Set<InvitationCode["status"]>([
  "active",
  "used",
  "accepted",
]);

/**
 * True if this invitation status counts as an "active collaborator".
 */
export function isActiveCollaboratorStatus(status: InvitationCode["status"] | undefined): boolean {
  if (!status) return false;
  return ACTIVE_COLLABORATOR_STATUSES.has(status);
}
