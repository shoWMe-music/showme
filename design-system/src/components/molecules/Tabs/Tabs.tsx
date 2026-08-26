import type { KeyboardEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { classNames } from "@/lib/classNames";
import { useTabsIndicator } from "./useTabsIndicator";
import styles from "./Tabs.module.css";

export interface TabItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  /**
   * A count riding on the label — how many unread messages, how many entries in
   * the history. Zero and undefined both render nothing: a badge saying "0" is
   * a badge that should not be there.
   */
  badge?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled active key. Omit to use `defaultValue` (uncontrolled). */
  value?: string;
  defaultValue?: string;
  onChange?: (key: string) => void;
  className?: string;
}

/**
 * Underline tabs from the event-details view: active tab is primary red with a
 * sliding 2px underline (GSAP), inactive is muted. Controlled or uncontrolled,
 * with arrow-key / Home / End navigation.
 */
export function Tabs({ tabs, value, defaultValue, onChange, className }: TabsProps) {
  const [internalKey, setInternalKey] = useState(defaultValue ?? tabs[0]?.key);
  const activeKey = value ?? internalKey;
  const tabElements = useRef(new Map<string, HTMLButtonElement>());
  const indicator = useTabsIndicator(
    activeKey,
    () => tabElements.current.get(activeKey) ?? null,
    tabs.map((tab) => `${tab.key}:${tab.badge ?? ""}`).join("|"),
  );

  const select = (key: string) => {
    if (value === undefined) setInternalKey(key);
    onChange?.(key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.key === activeKey);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextKey = tabs[nextIndex].key;
    select(nextKey);
    tabElements.current.get(nextKey)?.focus();
  };

  return (
    <div className={classNames(styles.tabs, className)} role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            ref={(node) => {
              if (node) tabElements.current.set(tab.key, node);
              else tabElements.current.delete(tab.key);
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={classNames(styles.tab, isActive && styles.active)}
            onClick={() => select(tab.key)}
          >
            {tab.icon && <span className={styles.icon}>{tab.icon}</span>}
            {tab.label}
            {tab.badge ? <span className={styles.badge}>{tab.badge}</span> : null}
          </button>
        );
      })}
      <span ref={indicator} className={styles.indicator} aria-hidden="true" />
    </div>
  );
}
