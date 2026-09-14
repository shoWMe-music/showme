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

/**
 * A denser eyebrow, for a label that names a SECTION INSIDE a card rather than a
 * field — "OTHER REVENUE", "TICKET TYPES (BOX OFFICE)".
 *
 * Measured off Ran's Budget Planner prototype: 10px at weight 600 with 1.4px of
 * tracking, against the 11px/400/0.88px above. Smaller AND heavier is the point —
 * it recedes in size while still reading as a divider, where our regular-weight
 * 11px read as another line of content. The default is untouched: it labels
 * fields on half a dozen other screens and moving it would repaint all of them.
 */
export const sectionEyebrowStyle: CSSProperties = {
  ...eyebrowStyle,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.14em",
};

/** A mono, letter-spaced, uppercase micro-label (INBOUND, WANTED DATE, FEE…). */
export function Eyebrow({
  children,
  style,
  section = false,
}: { children: ReactNode; style?: CSSProperties; section?: boolean }) {
  return (
    <span style={{ ...(section ? sectionEyebrowStyle : eyebrowStyle), ...style }}>{children}</span>
  );
}

/**
 * A card's own heading, in the display face — the Claude design titles every panel
 * this way ("Revenue & deductions", "Comments", "Approval Status"), with an
 * optional muted line under it.
 *
 * Distinct from `Eyebrow` on purpose. The mono micro-label names a FIELD inside a
 * card; this names the card. Using the eyebrow for both is what made our
 * settlement screen read as a different design from the one it was built from,
 * even where the structure matched.
 *
 * Sizes are the prototype's own: 18px for a panel in the main column, 17px in a
 * side rail, weight 500, and a 12.5px muted subtitle.
 */
export function CardTitle({
  children,
  subtitle,
  size = 18,
}: { children: ReactNode; subtitle?: ReactNode; size?: number }) {
  return (
    <div style={{ marginBottom: subtitle ? 12 : 8 }}>
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 500,
          fontSize: size,
          color: "var(--text)",
          margin: 0,
        }}
      >
        {children}
      </h3>
      {subtitle && (
        <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 0", lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
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
