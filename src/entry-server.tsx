import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { UserProvider } from "@/lib/user-context";
import { BreadcrumbProvider } from "@/components/TopBreadcrumb";
import { router as _routerSingleton } from "./router";

export interface RenderResult {
  html: string;           // rendered React HTML (goes inside <div id="root">)
  head: string;           // <title> and <meta> tags from route metadata
  dehydratedState: unknown; // dehydrated QueryClient state
}

export async function render(url: string): Promise<RenderResult> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
  });

  const history = createMemoryHistory({ initialEntries: [url] });
  const router = createRouter({ routeTree: _routerSingleton.routeTree, history });

  // Load matching routes (runs route loaders)
  await router.load();

  const html = renderToString(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <UserProvider>
            <BreadcrumbProvider>
              <HydrationBoundary state={dehydrate(queryClient)}>
                <RouterProvider router={router} />
              </HydrationBoundary>
            </BreadcrumbProvider>
          </UserProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );

  // Extract head metadata from matched routes
  const matches = router.state.matches;
  const lastMatch = matches[matches.length - 1];
  const meta = (lastMatch?.staticData as Record<string, unknown>)?.meta as Record<string, string> ?? {};
  const title = meta.title ?? "shoWMe";
  const description = meta.description ?? "";
  const head = [
    `<title>${title}</title>`,
    description ? `<meta name="description" content="${description}" />` : "",
    description ? `<meta property="og:description" content="${description}" />` : "",
    `<meta property="og:title" content="${title}" />`,
  ].filter(Boolean).join("\n    ");

  return { html, head, dehydratedState: dehydrate(queryClient) };
}
