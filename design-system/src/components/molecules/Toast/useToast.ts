import type { ReactNode } from "react";
import { useContext, useMemo } from "react";
import { ToastContext, type ToastOptions } from "./ToastProvider";

/**
 * Fire toasts imperatively. Requires a <ToastProvider> above in the tree.
 *
 *   const toast = useToast();
 *   toast("Archived Nils Frahm", { action: { label: "Undo", onClick: restore } });
 *   toast.success("Settlement sent");
 *   toast.error("Couldn't reach the venue");
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a <ToastProvider>");
  const { add, dismiss } = context;

  return useMemo(() => {
    const toast = (message: ReactNode, options?: ToastOptions) => add(message, options);
    toast.success = (message: ReactNode, options?: ToastOptions) => add(message, { status: "confirmed", ...options });
    toast.error = (message: ReactNode, options?: ToastOptions) => add(message, { status: "cancelled", ...options });
    toast.warning = (message: ReactNode, options?: ToastOptions) => add(message, { status: "pending", ...options });
    toast.info = (message: ReactNode, options?: ToastOptions) => add(message, { status: "task", ...options });
    toast.dismiss = dismiss;
    return toast;
  }, [add, dismiss]);
}
