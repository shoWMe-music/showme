import type { CSSProperties } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Corner radius (ignored when `circle`). Defaults to 8px. */
  radius?: number | string;
  /** Renders a circle (uses `width` — or `height` — for both dimensions). */
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A shimmering placeholder block for loading states. Compose several to
 * skeleton out a card, row or list. Decorative (aria-hidden); mark the
 * surrounding region `aria-busy`. Shimmer respects `prefers-reduced-motion`. */
export function Skeleton({ width, height = 14, radius = 8, circle = false, className, style }: SkeletonProps) {
  const shape: CSSProperties = circle
    ? { width: width ?? height, height: width ?? height, borderRadius: "50%" }
    : { width, height, borderRadius: radius };
  return <span aria-hidden="true" className={classNames(styles.skeleton, className)} style={{ ...shape, ...style }} />;
}
