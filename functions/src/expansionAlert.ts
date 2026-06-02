import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

const db = () => admin.firestore();

/**
 * Spec: "Open to all EU countries from day one. Country tag every
 * auto-created account. Threshold alert: when a new country crosses 10
 * auto-created accounts, surface as an expansion signal for sales."
 *
 * Approach: stub venue profiles (unclaimed:true) are tagged with `country`
 * at creation. This trigger fires on every new profile doc, ignores all
 * non-stub profiles, then counts how many stubs exist in the new doc's
 * country. If the count just crossed the threshold (== 10 right after this
 * write), we emit a single adminAlerts row keyed by country code so the
 * same country can't trigger twice.
 *
 * Mirror's the spec-faithful "single alert per new market" signal without
 * a daily cron or denormalized counter — Firestore count() aggregation is
 * cheap and avoids drift.
 */

export const EU_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
  "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT",
  "RO", "SK", "SI", "ES", "SE",
]);

const EXPANSION_THRESHOLD = 10;

export const onStubProfileCreatedExpansionCheck = onDocumentCreated(
  {
    document: "profiles/{profileId}",
    region: "europe-west1",
  },
  async (event) => {
    const data = event.data?.data() as Record<string, unknown> | undefined;
    if (!data) return;
    // Only stub venue profiles count for the expansion signal. Real-user
    // profiles, performer stubs (out of scope per spec wording), and
    // un-acquired placeholders all skip the trigger.
    if (data.unclaimed !== true) return;
    if (data.type !== "venue" && data.role !== "venue") return;

    const country = typeof data.country === "string" ? data.country.toUpperCase() : "";
    if (!country || !EU_COUNTRY_CODES.has(country)) return;

    // Single-write idempotency: doc id keyed by country code. If the alert
    // already exists for this country, the rest of the work is unnecessary
    // — bail before counting.
    const alertRef = db().collection("adminAlerts").doc(`expansion:${country}`);
    const existing = await alertRef.get();
    if (existing.exists) return;

    // Count distinct stubs in this country. Aggregation count() doesn't
    // pull docs, so it stays cheap even as we approach the threshold.
    let stubCount = 0;
    try {
      const snap = await db()
        .collection("profiles")
        .where("type", "==", "venue")
        .where("unclaimed", "==", true)
        .where("country", "==", country)
        .count()
        .get();
      stubCount = snap.data().count;
    } catch (err) {
      logger.warn("expansion-alert count failed", { country, err: String(err) });
      return;
    }

    if (stubCount < EXPANSION_THRESHOLD) return;

    try {
      await alertRef.set({
        kind: "expansion_threshold_crossed",
        country,
        stubCount,
        createdAt: FieldValue.serverTimestamp(),
        resolved: false,
      });
      logger.info("expansion alert emitted", { country, stubCount });
    } catch (err) {
      logger.warn("expansion-alert write failed", { country, err: String(err) });
    }
  },
);
