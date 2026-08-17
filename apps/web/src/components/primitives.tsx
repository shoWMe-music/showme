import type { CSSProperties, ReactNode } from "react";

/** Internal shared bits for the operator composites. Not exported from the
 * barrel — these keep the composites small and consistent (the mono uppercase
 * eyebrow, section labels) without repeating inline styles everywhere. All
 * colours come from DS tokens so both themes work. */

export const eyebrowStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

/** A mono, letter-spaced, uppercase micro-label (INBOUND, WANTED DATE, FEE…). */
export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ ...eyebrowStyle, ...style }}>{children}</span>;
}

/** One mono-eyebrow + value cell, used in the request/detail field grids. */
export function FieldCell({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Eyebrow>{label}</Eyebrow>
      <span style={{ color: "var(--text)", fontSize: 14 }}>{value}</span>
    </div>
  );
}
