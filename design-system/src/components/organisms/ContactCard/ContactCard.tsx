import { classNames } from "@/lib/classNames";
import { Avatar, type AvatarTone } from "@/components/atoms/Avatar/Avatar";
import { Badge } from "@/components/atoms/Badge/Badge";
import { Tag } from "@/components/atoms/Tag/Tag";
import styles from "./ContactCard.module.css";

export interface ContactCardProps {
  name: string;
  role: string;
  initials: string;
  tone?: AvatarTone;
  email?: string;
  /** IBAN/payout verified — drives the verified pill. */
  verified?: boolean;
  /** The linked on-platform profile shown in the footer, if any. */
  linkedProfile?: { handle: string; rating?: number; kind?: string };
  onViewProfile?: () => void;
  className?: string;
}

/** Composite: an address-book / roster card. Avatar + identity, a verified
 * payout pill, and a footer linking the on-platform profile. Built entirely
 * from the primitives (Avatar, Badge, Button, Tag). */
export function ContactCard({
  name,
  role,
  initials,
  tone = "amber",
  email,
  verified = false,
  linkedProfile,
  onViewProfile,
  className,
}: ContactCardProps) {
  return (
    <div className={classNames(styles.card, className)}>
      <Tag tone="dim">Contact card</Tag>
      <div className={styles.identity}>
        <Avatar initials={initials} tone={tone} size={40} />
        <div className={styles.who}>
          <div className={styles.name}>{name}</div>
          <div className={styles.role}>{role}</div>
        </div>
      </div>

      {email && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Email</span>
          <span className={styles.fieldValue}>{email}</span>
        </div>
      )}

      <div className={styles.pillRow}>
        <Badge status={verified ? "confirmed" : "pending"} dot>
          {verified ? "IBAN verified" : "Unverified"}
        </Badge>
      </div>

      {linkedProfile && (
        <div className={styles.footer}>
          <div className={styles.linked}>
            <span className={styles.mark}>s</span>
            <div className={styles.linkedText}>
              <div className={styles.linkedName}>shoWMe {linkedProfile.kind ?? "Performer"}</div>
              <div className={styles.linkedMeta}>
                {linkedProfile.handle}
                {linkedProfile.rating != null && ` · ★ ${linkedProfile.rating}`}
              </div>
            </div>
          </div>
          <button
            type="button"
            className={classNames(styles.viewBtn, "touch-target-overlay")}
            onClick={onViewProfile}
          >
            View profile
          </button>
        </div>
      )}
    </div>
  );
}
