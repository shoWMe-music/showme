import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin, ExternalLink } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { fetchProfilePreview, type ProfilePreviewData } from "@/lib/db";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

interface PublicProfileBadgeProps {
  /** Display name fallback (used when profile fetch fails or returns nothing). */
  name: string;
  /** Profile document ID — required to look up the avatar/slug for navigation. */
  profileId?: string;
  /** Avatar size. */
  size?: Size;
  /** Show the name next to the avatar (default true). */
  withName?: boolean;
  /** Override className on the trigger wrapper. */
  className?: string;
}

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
};

const FALLBACK_TEXT_CLASS: Record<Size, string> = {
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function PublicProfileBadge({
  name,
  profileId,
  size = "sm",
  withName = true,
  className,
}: PublicProfileBadgeProps) {
  const { data: profile } = useQuery<ProfilePreviewData | null>({
    queryKey: ["public-profile-badge", profileId],
    queryFn: () => fetchProfilePreview(profileId!),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  const avatarUrl = profile?.avatarUrl;
  const slug = profile?.slug;
  const displayName = profile?.name || name;

  const inner = (
    <>
      <Avatar className={cn(SIZE_CLASS[size], "shrink-0")}>
        {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
        <AvatarFallback className={cn(FALLBACK_TEXT_CLASS[size], "bg-muted text-muted-foreground font-medium")}>
          {getInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      {withName && <span className="truncate">{displayName}</span>}
    </>
  );

  // Without a slug we can't navigate, so render a plain avatar+name with no
  // hover card — keeps the layout consistent without dangling UI.
  if (!slug) {
    return (
      <span className={cn("inline-flex items-center gap-2 min-w-0", className)}>
        {inner}
      </span>
    );
  }

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Link
          to="/p/$slug"
          params={{ slug }}
          className={cn(
            "inline-flex items-center gap-2 rounded-full hover:bg-muted/50 transition-colors px-1 -mx-1 min-w-0",
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {inner}
        </Link>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-64 p-3" sideOffset={8}>
        <div className="flex gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="text-sm bg-muted text-muted-foreground font-medium">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-semibold truncate">{displayName}</p>
            {profile?.type && (
              <p className="text-xs text-muted-foreground capitalize">{profile.type}</p>
            )}
            {(profile?.city || profile?.country) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                {[profile.city, profile.country].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        </div>
        <Link
          to="/p/$slug"
          params={{ slug }}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> View profile
        </Link>
      </HoverCardContent>
    </HoverCard>
  );
}
