import { useEffect, useRef } from "react";
import { getAuth } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { getFirestoreDb } from "@/integrations/firebase/app";

export interface UseRefreshClaimsListenerOptions {
  /** null when signed out — hook is a no-op */
  uid: string | null;
  /** Called after the new ID token is in hand */
  onRefresh: () => void;
}

/**
 * Subscribes to `users/{uid}/_meta/refreshClaims`. When a server-side membership
 * change writes a new `ts` to that doc, we force-refresh the client's ID token
 * (so the new `profileIds` custom claim is in hand) and notify the caller so
 * they can invalidate any claim-dependent queries.
 *
 * Skips the first snapshot — it fires immediately on subscribe and would cause
 * a spurious refresh on every page load.
 */
export function useRefreshClaimsListener(
  opts: UseRefreshClaimsListenerOptions,
): void {
  const onRefreshRef = useRef(opts.onRefresh);

  useEffect(() => {
    onRefreshRef.current = opts.onRefresh;
  }, [opts.onRefresh]);

  useEffect(() => {
    if (!opts.uid) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    let db;
    try {
      db = getFirestoreDb();
    } catch {
      return;
    }
    if (!db) {
      return;
    }

    const ref = doc(db, "users", opts.uid, "_meta", "refreshClaims");
    let firstFired = false;

    const unsub = onSnapshot(
      ref,
      async (snapshot) => {
        if (!firstFired) {
          firstFired = true;
          return;
        }
        if (!snapshot.exists()) {
          return;
        }
        try {
          await getAuth().currentUser?.getIdToken(true);
        } catch {
          // If the token refresh fails, still let the caller invalidate —
          // a stale token will be retried on the next protected call.
        }
        onRefreshRef.current();
      },
      () => {
        // Snapshot listener errors are non-fatal — silently degrade.
      },
    );

    return () => {
      unsub();
    };
  }, [opts.uid]);
}
