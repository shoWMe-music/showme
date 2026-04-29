import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
// bcryptjs (pure JS) is used over native bcrypt to avoid build issues in the Cloud Functions runtime.
import * as bcrypt from "bcryptjs";

interface SetCollaboratorInvitePasswordData {
  inviteId: string;
  password: string;
}

export const setCollaboratorInvitePassword = onCall<
  SetCollaboratorInvitePasswordData,
  Promise<{ ok: true }>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in first (anonymous is fine).");
    }

    const inviteId = request.data?.inviteId;
    const password = request.data?.password;
    if (typeof inviteId !== "string" || inviteId.length < 8) {
      throw new HttpsError("invalid-argument", "Invalid invite id.");
    }
    if (typeof password !== "string" || password.length < 4) {
      throw new HttpsError("invalid-argument", "Password must be at least 4 characters.");
    }

    const db = admin.firestore();
    const ref = db.collection("collaboratorInvites").doc(inviteId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }
    const inv = snap.data() as Record<string, unknown>;

    const existingHash = inv.passwordHash;
    if (typeof existingHash === "string" && existingHash.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        "This invite already has a password set.",
      );
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await ref.update({
      passwordHash,
      status: "accepted",
    });

    return { ok: true };
  },
);
