// Boots SPA on routes that ssrRender served as SEO/OG-only HTML.
// We discard the SSR'd markup and createRoot from scratch — no hydration —
// so server/client divergence (auth state, browser APIs) can't break the page.
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { UserProvider } from "@/lib/user-context";
import { BreadcrumbProvider } from "@/components/TopBreadcrumb";
import { router as _routerSingleton } from "./router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

const router = createRouter({ routeTree: _routerSingleton.routeTree });

const rootEl = document.getElementById("root")!;
rootEl.innerHTML = "";

createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <UserProvider>
          <BreadcrumbProvider>
            <RouterProvider router={router} />
          </BreadcrumbProvider>
        </UserProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);
