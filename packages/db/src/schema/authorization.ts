import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./identity";

/**
 * A modular capability bundle attached to an event participant (or offered as a
 * reusable preset). `capabilities` holds `@showme/shared` capability strings;
 * validation that they are known capabilities lives in the app layer, not the DB.
 *
 * `profile_id` NULL = a system preset (e.g. "Schedule-only", "Host admin")
 * available to everyone; non-null = a profile's own custom set.
 */
export const permissionSets = pgTable("permission_sets", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  capabilities: text("capabilities").array().notNull().default([]),
});
