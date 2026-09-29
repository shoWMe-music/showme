/**
 * HOW THE TEAM SCREEN NAMES A PERSON — the three judgements it used to make inline.
 *
 * They are here and not in `Team.tsx` for the reason `components/attentionList.ts` gives about
 * itself: a decision inside a route cannot be tested, and one of these three was wrong for eight
 * days without anything being able to say so (QA sweep run 13, below).
 *
 * Deliberately NOT a shared `lib/initials`. Nine other files derive initials their own way, and
 * consolidating them is a separate job with its own risk — recorded in
 * `docs/codebase-reuse-audit.md`. This module claims only to be the Team screen's answer, which is
 * the one with a tested contract.
 */

/** A group member as the Team screen reads one — name, address, and what they are called here. */
export interface TeamMemberLabelSource {
  name?: string | null;
  email?: string | null;
  roleLabel?: string | null;
}

/**
 * A human label from the email local-part, for a member who has NO NAME to read.
 *
 * This used to be introduced with *"no display-name field exists on a group member"*, which was
 * true of the payload and false of the data: `users.name` was one join away and every other
 * screen read it, so Team called somebody "Professional" that Contacts called "Priya Sound"
 * (QA sweep run 11). The payload carries the name now and this is the fallback it always should
 * have been — a member invited by address who has not signed up has an email and nothing else.
 */
export function nameFromEmail(email: string | null | undefined): string | null {
  const local = email?.split("@")[0];
  if (!local) return null;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : null;
}

/** A group member's on-screen label — their own name, else their email, else their role. */
export function groupMemberLabel(member: TeamMemberLabelSource): string {
  return member.name?.trim() || nameFromEmail(member.email) || member.roleLabel || "Member";
}

/**
 * THE AVATAR'S TWO LETTERS — first word and last word, with any PARENTHETICAL removed first.
 *
 * A bracketed clause is an ANNOTATION on a name, never part of it, and a stored `users.name` really
 * does carry one: the seeded crew member is `Priya Sound (FOH engineer)` and the co-promoter is
 * `Northlight Presents (co-promoter)`. Taking the last word gave **PE** — P(riya) + e(ngineer) —
 * which is the dangerous kind of wrong, because it looks like a correct pair of initials. QA sweep
 * run 13 reported the same root cause over a different member (`T(` for The Lantern Hall, whose
 * stored name carries no parenthetical at all, so that example does not reproduce); the LINE it
 * named was right.
 *
 * Every parenthetical goes, not only a trailing one — "Jane (she/her) Doe" is the same shape — and
 * a label that is NOTHING but a parenthetical falls back to the unstripped text rather than
 * to "?", because a bracketed role is still the only name that member has.
 */
export function initials(label: string): string {
  const withoutEmail = label.replace(/@.*/, "");
  const stripped = withoutEmail.replace(/\([^)]*\)/g, " ").trim();
  /*
   * The fallback drops the BRACKET CHARACTERS, not the clause — and the first version of this fell
   * back to the unstripped label, which read "(O" for a member labelled only "(operator)". Its own
   * test caught it: putting the brackets back is not a fallback, it is the bug with extra steps.
   */
  const parts = (stripped || withoutEmail.replace(/[()]/g, " "))
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}
