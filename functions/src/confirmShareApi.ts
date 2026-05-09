import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";

import { SHARE_JWT_SECRET } from "./shareOtpApi";
import {
  assertEmailMatchesParty,
  isStringRecord,
  lowerEmail,
  resolveVerifiedShareEmail,
} from "./shareIdentity";

if (!admin.apps.length) {
  admin.initializeApp();
}

interface ConfirmShareData {
  token: string;
  party: string;
  jwt?: string;
}

interface ConfirmShareResponse {
  ok: true;
  verifiedEmail: string;
}

export async function handleConfirmShareParty(
  request: CallableRequest<ConfirmShareData>,
): Promise<ConfirmShareResponse> {
  const token = request.data?.token;
  const party = request.data?.party;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new HttpsError("invalid-argument", "token is required.");
  }
  if (typeof party !== "string" || party.trim().length === 0) {
    throw new HttpsError("invalid-argument", "party is required.");
  }

  const db = getFirestore();
  const shareRef = db.collection("publicShares").doc(token);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    throw new HttpsError("not-found", "Share link not found.");
  }
  const shareData = (shareSnap.data() ?? {}) as Record<string, unknown>;
  const access = shareData.access;
  if (access !== "protected") {
    // Public shares have no recipient identity to verify; legacy docs
    // missing `access` fail closed per design §7.
    throw new HttpsError(
      "failed-precondition",
      "Confirmation requires a protected share with a recipient list.",
    );
  }
  const eventId = typeof shareData.eventId === "string" ? shareData.eventId : "";
  if (!eventId) {
    throw new HttpsError("failed-precondition", "Share has no associated event.");
  }

  const verifiedEmail = resolveVerifiedShareEmail(request, token);
  await assertEmailMatchesParty(db, eventId, party, verifiedEmail);

  const settlementRef = db
    .collection("events").doc(eventId)
    .collection("settlement").doc("main");
  const nowIso = new Date().toISOString();
  const dateOnly = nowIso.slice(0, 10);

  await db.runTransaction(async (tx) => {
    const [shareTxSnap, settlementTxSnap] = await Promise.all([
      tx.get(shareRef),
      tx.get(settlementRef),
    ]);
    if (!shareTxSnap.exists) {
      throw new HttpsError("not-found", "Share link not found.");
    }
    const sd = (shareTxSnap.data() ?? {}) as Record<string, unknown>;
    const existingConfirmations = Array.isArray(sd.confirmations)
      ? (sd.confirmations as Record<string, unknown>[])
      : [];
    // Dedupe on (party, email): repeat confirmations from the same verified
    // email refresh the timestamp instead of growing the array unbounded.
    const filteredConfirmations = existingConfirmations.filter((c) => {
      if (!isStringRecord(c)) return true;
      const cParty = typeof c.party === "string" ? c.party : "";
      const cEmail = lowerEmail(c.email);
      return !(cParty === party && cEmail === verifiedEmail);
    });
    filteredConfirmations.push({
      party,
      email: verifiedEmail,
      confirmedAt: nowIso,
    });

    const settlementData = (settlementTxSnap.exists ? settlementTxSnap.data() : {}) ?? {};
    const existingApprovals = Array.isArray((settlementData as Record<string, unknown>).approvals)
      ? ((settlementData as Record<string, unknown>).approvals as Record<string, unknown>[])
      : [];
    // approvals[] is keyed by party (one per slot) — replace existing entry so
    // the latest confirmer wins. confirmations[] (above) keeps the audit log.
    const filteredApprovals = existingApprovals.filter((a) => {
      if (!isStringRecord(a)) return true;
      return a.party !== party;
    });
    filteredApprovals.push({ party, approved: true, date: dateOnly });

    tx.set(shareRef, { confirmations: filteredConfirmations }, { merge: true });
    tx.set(settlementRef, { approvals: filteredApprovals }, { merge: true });
  });

  return { ok: true, verifiedEmail };
}

export const confirmShareParty = onCall<ConfirmShareData, Promise<ConfirmShareResponse>>(
  { region: "europe-west1", memory: "256MiB", secrets: [SHARE_JWT_SECRET] },
  handleConfirmShareParty,
);
