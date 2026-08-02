import type { HTMLAttributes } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./Avatar.module.css";

export type AvatarTone = "amber" | "green" | "purple" | "blue" | "brand";
export type AvatarShape = "square" | "circle";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Initials, e.g. "NF". Ignored when `src` is set. */
  initials?: string;
  src?: string;
  alt?: string;
  tone?: AvatarTone;
  shape?: AvatarShape;
  size?: number;
}

/* Exact tint (.16) + hue literals from the catalog avatars. */
const TONE: Record<AvatarTone, { bg: string; fg: string }> = {
  amber: { bg: "rgba(244,160,70,.16)", fg: "#F4A046" },
  green: { bg: "rgba(111,201,122,.16)", fg: "#6FC97A" },
  purple: { bg: "rgba(181,139,224,.16)", fg: "#B58BE0" },
  blue: { bg: "rgba(111,168,224,.16)", fg: "#6FA8E0" },
  brand: { bg: "linear-gradient(135deg, #EE5746, #F4A046)", fg: "#fff" },
};

/** Initials or image avatar. Rounded-square by default (the product's house
 * style); `circle` for user chips. Tones echo the status/brand hues. */
export function Avatar({
  initials,
  src,
  alt,
  tone = "amber",
  shape = "square",
  size = 44,
  className,
  style,
  ...rest
}: AvatarProps) {
  const toneStyle = TONE[tone];
  const radius = shape === "circle" ? "50%" : Math.round(size * 0.27);
  return (
    <span
      className={classNames(styles.avatar, className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: src ? undefined : toneStyle.bg,
        color: toneStyle.fg,
        fontSize: Math.round(size * 0.32),
        ...style,
      }}
      {...rest}
    >
      {src ? <img className={styles.img} src={src} alt={alt ?? initials ?? ""} style={{ borderRadius: radius }} /> : initials}
    </span>
  );
}
