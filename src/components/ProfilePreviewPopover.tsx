import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, MapPin, ExternalLink } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { fetchProfilePreview, type ProfilePreviewData } from "@/lib/db";
import { useContacts } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface ProfilePreviewPopoverProps {
  /** The display name (performer name, venue name). */
  name: string;
  /** Profile document ID — if known, used to fetch avatar + preview data. */
  profileId?: string;
  /** Optional avatar URL if already available (avoids extra fetch). */
  avatarUrl?: string;
  /** Size of the inline avatar. */
  size?: "sm" | "md";
  /** Called when the user clicks "Invite" in the popover. */
  onInvite?: () => void;
  /** Additional className for the trigger wrapper. */
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProfilePreviewPopover({
  name,
  profileId,
  avatarUrl: avatarUrlProp,
  size = "sm",
  onInvite,
  className,
}: ProfilePreviewPopoverProps) {
  const [open, setOpen] = useState(false);

  const { data: profileData } = useQuery<ProfilePreviewData | null>({
    queryKey: ["profile-preview", profileId],
    queryFn: () => fetchProfilePreview(profileId!),
    enabled: !!profileId && open,
    staleTime: 5 * 60 * 1000,
  });

  const contacts = useContacts();
  const matchedContact = contacts.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );

  const avatarUrl = profileData?.avatarUrl ?? avatarUrlProp;
  const hasProfile = !!profileData;
  const hasContact = !!matchedContact;
  const isInvited = hasProfile || hasContact;

  const avatarSizeClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const textClass = size === "sm" ? "text-[10px]" : "text-xs";

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full hover:bg-muted/50 transition-colors px-1 -mx-1 cursor-pointer",
            className,
          )}
        >
          <Avatar className={cn(avatarSizeClass, "shrink-0")}>
            {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
            <AvatarFallback className={cn(textClass, "bg-muted text-muted-foreground font-medium")}>
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
          <span>{name}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-64 p-3" sideOffset={8}>
        <div className="flex gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
            <AvatarFallback className="text-sm bg-muted text-muted-foreground font-medium">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-semibold truncate">{profileData?.name || name}</p>
            {profileData?.type && (
              <p className="text-xs text-muted-foreground capitalize">{profileData.type}</p>
            )}
            {(profileData?.city || profileData?.country) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                {[profileData.city, profileData.country].filter(Boolean).join(", ")}
              </p>
            )}
            {!hasProfile && hasContact && (
              <p className="text-xs text-muted-foreground capitalize">
                {Array.isArray(matchedContact.type) ? matchedContact.type.join(", ") : matchedContact.type}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {hasProfile && profileData?.slug && profileData.isPublic && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 flex-1" asChild>
              <a href={`/p/${profileData.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" /> View Profile
              </a>
            </Button>
          )}
          {hasProfile && profileData?.slug && !profileData.isPublic && (
            // Internal (non-public) profile — same-tab link to the slug page,
            // which falls back to a local lookup for owners/collaborators.
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 flex-1" asChild>
              <Link to="/p/$slug" params={{ slug: profileData.slug }}>
                <ExternalLink className="h-3 w-3" /> View Profile
              </Link>
            </Button>
          )}
          {!hasProfile && hasContact && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 flex-1" asChild>
              <Link to="/contacts/$id" params={{ id: matchedContact.id }}>
                <ExternalLink className="h-3 w-3" /> View Contact
              </Link>
            </Button>
          )}
          {!isInvited && onInvite && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 flex-1"
              onClick={() => {
                setOpen(false);
                onInvite();
              }}
            >
              <UserPlus className="h-3 w-3" /> Invite
            </Button>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
