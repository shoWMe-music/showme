/** The fixed status vocabulary from the design system's "Status palette".
 * In the source these are HARDCODED literals (there are no --status-* tokens),
 * each with a `.14`-alpha tint used for chip/badge fills. Kept exact.
 *
 * `showday` is the ONE addition to the prototype's palette, asked for directly
 * (ClickUp `123qy9rng4z`: *"show-day status missing — with its glowing
 * animation"*). It is not a value anything stores: no `event_status` enum member
 * matches it, because show day is a fact about the calendar rather than about the
 * booking — a confirmed show becomes one on its date and stops being one at local
 * midnight. See `apps/web/src/lib/status.ts` for the derivation. */
export const STATUSES = [
  "suggested",
  "pending",
  "confirmed",
  "hold",
  "concluded",
  "cancelled",
  "draft",
  "task",
  "showday",
  "external",
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  suggested: "Suggested",
  pending: "Pending",
  confirmed: "Confirmed",
  hold: "On hold",
  concluded: "Concluded",
  cancelled: "Cancelled",
  draft: "Draft",
  task: "Task",
  showday: "Show day",
  external: "External",
};

/** Exact hue + `.14` tint fill for each status, verbatim from the source. */
export const STATUS_COLOR: Record<Status, { fg: string; tint: string }> = {
  suggested: { fg: "#B58BE0", tint: "rgba(181,139,224,.14)" },
  pending: { fg: "#F4A046", tint: "rgba(244,160,70,.14)" },
  confirmed: { fg: "#6FC97A", tint: "rgba(111,201,122,.14)" },
  hold: { fg: "#FFC266", tint: "rgba(255,194,102,.14)" },
  concluded: { fg: "#B8A99B", tint: "rgba(184,169,155,.14)" },
  cancelled: { fg: "#EE5746", tint: "rgba(238,87,70,.14)" },
  draft: { fg: "#8C7A6C", tint: "rgba(140,122,108,.14)" },
  task: { fg: "#6FA8E0", tint: "rgba(111,168,224,.14)" },
  /* Neon marquee pink — the one status hue that is NOT from the warm brand ramp,
     and chosen by measurement rather than taste.

     The first attempt was `--brand-red-glow` (#FF7A68), the palette's own glow
     colour, on the reasoning that the hottest brand colour belonged to the hottest
     night. Rendered into the real calendar legend next to `cancelled` (#EE5746),
     the two dots were indistinguishable. That is the one confusion this status
     cannot afford: a show that is ON tonight reading as a show that is OFF.

     Five candidates were then drawn into that same legend and compared — coral,
     this pink, a hot gold, a teal and a violet. The gold collided with `hold` and
     `note`, the teal with the calendar's task cyan, and the violet sat too close
     to `suggested`. This one is unambiguous against every existing dot. Its
     nearest neighbour is the calendar's Appointment magenta, and mistaking "show
     day" for "you have something on today" costs nobody anything. */
  showday: { fg: "#FF4FA3", tint: "rgba(255,79,163,.14)" },
  /* Cool slate — an entry imported from somebody else's calendar (ClickUp
     `123qy9rpdum`), and the second hue chosen by rendering rather than by taste.

     It shared `concluded`'s warm grey (#B8A99B) deliberately: an imported entry is
     background, and the palette had every hue spoken for, so the WORD did the telling
     apart. Ran read the two dots as one and he is right that they are — they were
     literally the same value.

     Four candidates were drawn into the real legend, on both grounds, and compared
     (`docs/screenshots/urgent-loop-2026-09-27/external-hue-candidates.png`): this slate,
     a deeper one, a lighter blue-grey and a steel. The light blue-grey sits at almost
     the same LIGHTNESS as `concluded`, which is the one dot it has to differ from; the
     steel drifts into the blue the tasks already own (#6FA8E0). This one is cool where
     both greys are warm — unmistakable beside `concluded` and `draft` — while staying a
     neutral rather than claiming a brand hue, which is what "not shoWMe's" should look
     like. */
  external: { fg: "#8FA3B8", tint: "rgba(143,163,184,.14)" },
};

/**
 * Statuses whose chip breathes rather than sits still.
 *
 * A set rather than a `glow` prop on every call site, because a glow that each
 * renderer has to remember is a glow that some renderer will forget — and an
 * event that pulses on the calendar but not in the list is worse than one that
 * never pulses at all. Everything that draws a status reads this.
 *
 * Only `showday` is in it, and the reason it is a set anyway is that `Badge` and
 * `StatusDot` both need the answer and must not disagree about it.
 */
export const GLOWING_STATUSES: ReadonlySet<Status> = new Set<Status>(["showday"]);
