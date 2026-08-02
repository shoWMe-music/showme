import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ToastProvider } from "@showme/design-system";
import "@showme/design-system/styles.css";
import "./app.css";
import { router } from "./router";

const queryClient = new QueryClient();
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
