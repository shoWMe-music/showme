import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { Transaction } from "./audit";

/** The per-issuer billing identity we persist in `profiles.billing` (jsonb). */
interface Billing {
  legalName?: string;
  address?: string;
  vatId?: string;
  vatRegistered?: boolean;
  vatRate?: number;
  /** Gapless invoice counter, PER YEAR (decisions #5): `{ "2026": 42 }`. */
  invoiceNumberByYear?: Record<string, number>;
}

/**
 * Hand out the next invoice number for an issuer — a REAL stored gapless sequence
 * (decisions #5), the deliberate exception to "counters are derived". Year-prefixed
 * and reset yearly: `2026-0001`, `2026-0002`, … → `2027-0001`. Three guarantees:
 *   - **Concurrency-safe:** the issuer's `profiles` row is locked `FOR UPDATE`, so
 *     two simultaneous issues serialize into N and N+1, never the same N.
 *   - **Gapless:** the counter is bumped inside the SAME transaction that commits the
 *     invoice — a rolled-back issue consumes nothing; a committed one always takes next.
 *   - **Void never renumbers:** voiding an invoice leaves this counter untouched, so
 *     the number stays consumed and history is stable.
 * Only `issued` (AR) invoices are numbered here; a `received` bill keeps the external
 * number the sender assigned.
 */
export async function nextInvoiceNumber(
  tx: Transaction,
  issuerProfileId: string,
  year: number,
): Promise<string> {
  const [profile] = await tx
    .select({ billing: schema.profiles.billing })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, issuerProfileId))
    .for("update");
  if (!profile) throw new Error("issuer profile not found");

  const billing = (profile.billing ?? {}) as Billing;
  const byYear = { ...(billing.invoiceNumberByYear ?? {}) };
  const key = String(year);
  const next = (byYear[key] ?? 0) + 1;
  byYear[key] = next;

  await tx
    .update(schema.profiles)
    .set({ billing: { ...billing, invoiceNumberByYear: byYear } })
    .where(eq(schema.profiles.id, issuerProfileId));

  return `${key}-${String(next).padStart(4, "0")}`;
}
