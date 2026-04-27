import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  to?: string;
  params?: Record<string, string>;
  icon?: LucideIcon;
}

interface BreadcrumbContextValue {
  items: BreadcrumbItem[];
  setItems: (items: BreadcrumbItem[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  items: [],
  setItems: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[]>([]);
  return (
    <BreadcrumbContext.Provider value={{ items, setItems }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

/** Call from any page to set the breadcrumb trail. Clears on unmount. */
export function useBreadcrumbs(items: BreadcrumbItem[]) {
  const { setItems } = useContext(BreadcrumbContext);
  const key = items.map(i => `${i.label}|${i.to || ""}`).join(">");
  useEffect(() => {
    setItems(items);
    return () => setItems([]);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function TopBreadcrumbBar() {
  const { items } = useContext(BreadcrumbContext);
  if (items.length === 0) return null;

  return (
    <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const Icon = item.icon;

        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="mx-1 select-none">/</span>}
            {isLast ? (
              <span className="font-medium text-foreground inline-flex items-center gap-1.5">
                {Icon && <Icon className="h-4 w-4" />}
                {item.label}
              </span>
            ) : item.to ? (
              <Link
                to={item.to}
                params={item.params}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              >
                {Icon && <Icon className="h-4 w-4" />}
                {item.label}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                {Icon && <Icon className="h-4 w-4" />}
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
