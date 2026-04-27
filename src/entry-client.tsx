// Hydrates pages that were server-rendered by the SSR function.
// For SPA (authenticated) pages, main.tsx is still used.
import { hydrateRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider, HydrationBoundary } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { router as _routerSingleton } from "./router";
import "./index.css";

const dehydratedState = (window as Window & { __DEHYDRATED_STATE__?: unknown }).__DEHYDRATED_STATE__ ?? {};

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

const router = createRouter({ routeTree: _routerSingleton.routeTree });

hydrateRoot(
  document.getElementById("root")!,
  <QueryClientProvider client={queryClient}>
    <HydrationBoundary state={dehydratedState}>
      <RouterProvider router={router} />
    </HydrationBoundary>
  </QueryClientProvider>
);
