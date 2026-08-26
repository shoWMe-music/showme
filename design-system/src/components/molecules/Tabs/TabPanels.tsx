import type { HTMLAttributes, ReactNode } from "react";
import { useTabPanelMotion } from "./useTabPanelMotion";

export interface TabPanelsProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The active tab key. A change to this is what triggers the scoot. */
  activeKey: string;
  /** Every tab key in display order — the direction of the scoot comes from it. */
  order: readonly string[];
  /** Whatever the call site already renders for the active tab. */
  children: ReactNode;
}

/**
 * Wraps tab content so it scoots in from the side the tab moved, instead of
 * flipping. Deliberately a WRAPPER around whatever the call site already
 * renders — `{tab === "budget" && <BudgetTab/>}` and friends keep working
 * untouched, and no screen has to learn how to animate itself.
 *
 * All the behaviour is in `useTabPanelMotion`; this is markup and nothing else.
 * It sets no `role` of its own: pair it with a real `tablist` (the `Tabs`
 * component) by passing `role="tabpanel"` plus the labelling attributes, so an
 * orphan `tabpanel` is never asserted where no `tablist` exists.
 */
export function TabPanels({ activeKey, order, children, ...rest }: TabPanelsProps) {
  const panel = useTabPanelMotion(activeKey, order);
  return (
    <div ref={panel} {...rest}>
      {children}
    </div>
  );
}
