import { configureApiClient } from "@showme/api-client";
import { Spinner, ToastProvider } from "@showme/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AuthScreen } from "./auth/AuthScreen";
import { OnboardingFlow } from "./auth/OnboardingFlow";
import { auth } from "./auth/firebase";
import { getActiveProfileId } from "./lib/activeProfile";
import "./fonts.css";
import "@showme/design-system/styles.css";
import "./app.css";
import { router } from "./router";

// Every generated hook reads the token from Firebase's current user; it refreshes
// automatically. `getProfileId` will supply the acting profile once profile
// switching lands.
configureApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8080",
  getToken: () => auth.currentUser?.getIdToken() ?? null,
  getProfileId: () => getActiveProfileId(),
});

const queryClient = new QueryClient();
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

/** Loading → spinner; signed-out / needs-provisioning → auth screen; otherwise the app. */
function AuthGate() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
        <Spinner />
      </div>
    );
  }
  if (status === "authed") return <RouterProvider router={router} />;
  if (status === "onboarding") return <OnboardingFlow />;
  return <AuthScreen />;
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
