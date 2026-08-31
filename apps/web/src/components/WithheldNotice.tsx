import { Icon } from "@showme/design-system";

/**
 * "Not on your public page" — the one marker Preview uses for anything the open
 * web is not given (`docs/decisions.md` #19).
 *
 * Preview's job is to answer "what does a stranger see". Silently omitting a
 * field the owner spent time filling in answers a DIFFERENT question badly: the
 * owner concludes the data was lost. Showing it under this marker answers both at
 * once — here is what you entered, and here is the part that stays off the open
 * web.
 *
 * It is one component because it is one promise. Two withheld blocks now draw it
 * (the venue's trade half in `VenueSpecsCard`, the performer's line-ups in
 * `ProfilePublicPreview`), and a marker that says "hidden" in two slightly
 * different ways is a marker an owner has to interpret twice.
 */
export function WithheldNotice({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ color: "var(--muted)", display: "flex" }}>
          <Icon name="eye-off" size={14} />
        </span>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          Not on your public page
        </p>
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>{children}</p>
    </div>
  );
}
