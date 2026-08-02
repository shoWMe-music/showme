import { type Database, schema } from "@showme/db";
import { eq, getTableColumns, getTableName, inArray, or } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { PII_INVENTORY } from "./pii-inventory";

/**
 * GDPR erasure + export, driven by the PII inventory (docs/gdpr.md).
 *
 * Erasure is **anonymize-not-delete, scoped to shoWMe-controller data**: tombstone
 * the identity, delete the personal-content bucket, and KEEP the balanced financial
 * records (settlements/invoices/transfers/audit) with their PII stripped — Art.
 * 17(3) exempts data held for a legal obligation (EU accounting retention). Export
 * is the twin: the same inventory walked in the opposite direction.
 */

/** Resolve a Drizzle column by its property name, or fail loudly (inventory bug). */
function columnOf(table: PgTable, propertyName: string): PgColumn {
  const column = getTableColumns(table)[propertyName];
  if (!column) {
    throw new Error(`Column "${propertyName}" not found on table "${getTableName(table)}"`);
  }
  return column;
}

/** Project only the inventory's PII columns out of a full row. */
function pickPii(
  row: Record<string, unknown>,
  piiColumns: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const propertyName of piiColumns) {
    picked[propertyName] = row[propertyName];
  }
  return picked;
}

/**
 * Tombstone a user in one transaction (Right to erasure, Art. 17):
 *  1. Overwrite the `users` PII (email → `anonymized+<id>@deleted.invalid`, name /
 *     initials / avatar → null) and set `anonymized_at`, but KEEP the pseudonymous
 *     `id` so FKs stay valid and `Σ net = 0` still holds on retained settlements.
 *  2. Delete the deletable bucket the user owns: profile media, social links, and
 *     the user's notifications.
 *  3. Anonymize the actor display name on `activity_log` but KEEP `actor_user_id`.
 *     (docs/gdpr.md names `audit_log.actor_display`, but in this schema the forensic
 *     `audit_log` carries only the pseudonymous `actor_user_id` — retained for
 *     integrity — and the actor's display NAME lives on `activity_log`.)
 *
 * Settlements, invoices, transfers, and audit rows are NEVER deleted. Deleting the
 * Firebase Auth account is a separate step outside this DB-only service.
 */
export async function anonymizeUser(database: Database, userId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const tombstoned = await tx
      .update(schema.users)
      .set({
        email: `anonymized+${userId}@deleted.invalid`,
        name: null,
        initials: null,
        avatarUrl: null,
        anonymizedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning({ id: schema.users.id });

    if (tombstoned.length === 0) {
      throw new Error(`Cannot anonymize: user "${userId}" not found`);
    }

    const ownedProfiles = await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.ownerUserId, userId));
    const ownedProfileIds = ownedProfiles.map((profile) => profile.id);

    if (ownedProfileIds.length > 0) {
      await tx
        .delete(schema.profileMedia)
        .where(inArray(schema.profileMedia.profileId, ownedProfileIds));
      await tx
        .delete(schema.profileSocialLinks)
        .where(inArray(schema.profileSocialLinks.profileId, ownedProfileIds));
    }

    await tx.delete(schema.notifications).where(eq(schema.notifications.userId, userId));

    await tx
      .update(schema.activityLog)
      .set({ actorDisplay: null })
      .where(eq(schema.activityLog.actorUserId, userId));
  });
}

/** A subject-access / portability export: the user's PII grouped by table. */
export interface UserDataExport {
  readonly userId: string;
  readonly exportedAt: string;
  readonly data: Record<string, Record<string, unknown>[]>;
}

/**
 * Gather all of a user's PII across the inventory into a JSON object (Art. 15
 * subject access / Art. 20 portability — the twin of erasure). Rows are matched by
 * a direct user FK, by the user's email (off-platform rows), or via the user's
 * owned profiles, exactly as the inventory declares.
 */
export async function exportUserData(database: Database, userId: string): Promise<UserDataExport> {
  const [user] = await database.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    throw new Error(`Cannot export: user "${userId}" not found`);
  }

  const ownedProfiles = await database
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.ownerUserId, userId));
  const ownedProfileIds = ownedProfiles.map((profile) => profile.id);

  const data: Record<string, Record<string, unknown>[]> = {};

  for (const spec of PII_INVENTORY) {
    const conditions = [];
    if (spec.userColumn) {
      conditions.push(eq(columnOf(spec.table, spec.userColumn), userId));
    }
    if (spec.emailColumn && user.email) {
      conditions.push(eq(columnOf(spec.table, spec.emailColumn), user.email));
    }
    if (spec.profileColumn && ownedProfileIds.length > 0) {
      conditions.push(inArray(columnOf(spec.table, spec.profileColumn), ownedProfileIds));
    }
    if (conditions.length === 0) {
      continue;
    }

    const rows = (await database
      .select()
      .from(spec.table)
      .where(or(...conditions))) as Record<string, unknown>[];

    if (rows.length > 0) {
      data[spec.tableName] = rows.map((row) => pickPii(row, spec.piiColumns));
    }
  }

  return { userId, exportedAt: new Date().toISOString(), data };
}
