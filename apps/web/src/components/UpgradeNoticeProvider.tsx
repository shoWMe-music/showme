import { Modal } from "@showme/design-system";
import { type ReactNode, useEffect, useState } from "react";
import { entitlementReason, isEntitlementError } from "../lib/errors";
import { router } from "../router";
import { UpgradeNotice } from "./UpgradeNotice";

/**
 * THE one place in the web app that recognises a plan refusal.
 *
 * Every mutation in the app already reports its own failure with a toast; a plan
 * gate needs more than a toast, and it needs the SAME more everywhere. So instead
 * of teaching a dozen screens about plans, `reportEntitlementError` is wired once
 * into the TanStack `MutationCache` in `main.tsx`: any mutation anywhere that comes
 * back `403 entitlement_required` (see `apps/api/src/lib/entitlements.ts`) raises
 * this notice, and the screen that fired it needs to know nothing about pricing.
 *
 * Deliberately MUTATIONS only. A background query refetch that 403s must not throw
 * a modal in the user's face — the notice answers something the user just TRIED
 * to do.
 */

/** Subscribers of the module-level channel. React state can't be reached from the cache callback. */
type Listener = (reason: string | null) => void;
const listeners = new Set<Listener>();

/**
 * Wire this as the `MutationCache` `onError` (or call it from one). Non-entitlement
 * errors pass straight through — the screen's own `onError` toast still runs, since
 * the cache-level handler does not consume the error.
 */
export function reportEntitlementError(error: unknown): void {
  if (!isEntitlementError(error)) return;
  const reason = entitlementReason(error);
  for (const listener of listeners) listener(reason);
}

export function UpgradeNoticeProvider({ children }: { children: ReactNode }) {
  /** `null` = closed. A string (possibly empty) = open, carrying the API's reason. */
  const [reason, setReason] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const listener: Listener = (nextReason) => {
      setReason(nextReason);
      setOpen(true);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const close = () => setOpen(false);

  return (
    <>
      {children}
      <Modal open={open} onClose={close} width={560}>
        <UpgradeNotice
          surface="plain"
          reason={reason}
          onDismiss={close}
          onSeePlans={() => {
            close();
            // The router instance directly, not `useNavigate`: this provider is
            // mounted ABOVE `<RouterProvider>` (it must survive the signed-out and
            // onboarding screens too), so there is no router context to read. The
            // hash is the settings tab — see `routes/Settings.tsx`.
            router.navigate({ to: "/settings", hash: "billing" });
          }}
        />
      </Modal>
    </>
  );
}
