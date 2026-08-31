import { type HTMLAttributes, useEffect, useState } from "react";
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
  // A picture that will not load falls back to the initials it was covering.
  // This is not defensive padding: profile images are served as SIGNED URLs
  // that expire after 15 minutes, so any page left open long enough reaches
  // this state on its own, as does a revoked file or an offline moment. Without
  // the fallback the browser draws its broken-image box, which is both ugly and
  // WIDER than the avatar asked for — measured, a broken image inside an 18px
  // avatar is 20px, which overflows the box it is meant to fill.
  const [failed, setFailed] = useState(false);
  // A new `src` deserves a fresh attempt; without this, one failure would make
  // the avatar permanently initials-only even after the URL is re-signed.
  useEffect(() => setFailed(false), [src]);
  const showImage = Boolean(src) && !failed;
  return (
    <span
      className={classNames(styles.avatar, className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: showImage ? undefined : toneStyle.bg,
        color: toneStyle.fg,
        fontSize: Math.round(size * 0.32),
        ...style,
      }}
      {...rest}
    >
      {showImage ? (
        <img
          className={styles.img}
          src={src}
          alt={alt ?? initials ?? ""}
          style={{ borderRadius: radius }}
          onError={() => setFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
