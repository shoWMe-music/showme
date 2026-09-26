import { ApiError, configureApiClient } from "@showme/api-client";
import { Spinner, ToastProvider } from "@showme/design-system";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AuthScreen } from "./auth/AuthScreen";
import { OnboardingFlow } from "./auth/OnboardingFlow";
import { auth } from "./auth/firebase";
import { UpgradeNoticeProvider, reportEntitlementError } from "./components/UpgradeNoticeProvider";
import { getActiveProfileId } from "./lib/activeProfile";
import "./fonts.css";
import "@showme/design-system/styles.css";
import "./app.css";
import { invitationTokenFromLocation, router, shareTokenFromPath } from "./router";
import { InvitationLanding } from "./routes/InvitationLanding";
import { ShareViewer } from "./routes/ShareViewer";

// Every generated hook reads the token from Firebase's current user; it refreshes
// automatically. `getProfileId` will supply the acting profile once profile
// switching lands.
configureApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8080",
  getToken: () => auth.currentUser?.getIdToken() ?? null,
  getProfileId: () => getActiveProfileId(),
});

// One cache-level error hook so a PLAN refusal (403 `entitlement_required`) raises
// the upgrade notice from wherever it happened — no screen needs to know about
// pricing. It does not consume the error: each mutation's own `onError` toast
// still runs.
const queryClient = new QueryClient({
  mutationCache: new MutationCache({ onError: reportEntitlementError }),
  defaultOptions: {
    queries: {
      /**
       * A REFUSAL IS NOT A FLAKE — do not ask four more times.
       *
       * TanStack retries a failed query three times by default, which is right for a
       * dropped connection and wrong for every answer the server meant. A workspace
       * tab a party may not open fired FIVE requests and logged five console errors
       * per query: measured 2026-09-26 on a view-only co-operator's event, twenty
       * failed requests and twenty errors on one visit, which buries anything real
       * in the console and hammers the API for an answer that cannot change.
       *
       * 4xx is the server stating a fact about this caller — missing capability,
       * gone, malformed. 408 and 429 are the exceptions: both are explicitly "try
       * again". Everything else (5xx, a network error with no status) keeps the
       * default two further attempts.
       */
      retry: (failureCount, error) => {
        const status = error instanceof ApiError ? error.status : null;
        if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

/**
 * Loading → spinner; signed-out / needs-provisioning → auth screen; otherwise the
 * app. EXCEPT on a share link, which is answered before any of that.
 *
 * A share recipient has no shoWMe account — that is the definition of the surface
 * — so the viewer cannot live behind the sign-in screen. Its credential is the
 * token in the URL plus the one-time code the API challenges for, and both are
 * handled inside the viewer. Deciding this from the pathname, before `useAuth`
 * resolves, also means a recipient never sees a sign-in form flash first.
 */
function AuthGate() {
  const { status } = useAuth();
  const shareToken = shareTokenFromPath(window.location.pathname);
  if (shareToken) return <ShareViewer token={shareToken} />;
  if (status === "loading") {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
        <Spinner />
      </div>
    );
  }
  // An invitation link, like a share link, arrives at a person who is usually
  // signed out and may have no account at all — so it is answered ahead of the
  // three branches below rather than behind them. It is placed AFTER the loading
  // check, not before it like the share branch, because unlike a share it needs
  // to know who is signed in: the same link says "accept" to one account and
  // "this is not for you" to another. The page composes `AuthScreen` and
  // `OnboardingFlow` itself, which is what lets the token survive a signup.
  const invitationToken = invitationTokenFromLocation(window.location);
  if (invitationToken) return <InvitationLanding token={invitationToken} />;
  if (status === "authed") return <RouterProvider router={router} />;
  if (status === "onboarding") return <OnboardingFlow />;
  return <AuthScreen />;
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <UpgradeNoticeProvider>
            <AuthGate />
          </UpgradeNoticeProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
