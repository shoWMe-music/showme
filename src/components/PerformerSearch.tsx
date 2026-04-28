import { useEffect, useState } from "react";
import { MapPin, Music, Contact } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, ComboboxOption, ComboboxEmpty, ComboboxLoading } from "@/components/ui/combobox";
import { useQuery } from "@tanstack/react-query";
import { searchArtistProfiles } from "@/lib/db";
import { queryKeys, useContacts } from "@/lib/queries";
import type { ArtistProfileResult } from "@/lib/db";
import { formatLocation, getPrimaryLocation } from "@/lib/user-context";

interface PerformerSearchProps {
  value: string;
  onChange: (name: string, profile?: ArtistProfileResult) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function PerformerSearch({
  value,
  onChange,
  placeholder = "Search performers…",
  className,
  disabled,
}: PerformerSearchProps) {
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const [debouncedTerm, setDebouncedTerm] = useState("");

  const contacts = useContacts();

  useEffect(() => { setSearch(value); }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: queryResult, isPending: loading } = useQuery({
    queryKey: queryKeys.artistSearch(debouncedTerm, open),
    queryFn: () => searchArtistProfiles(debouncedTerm, 8, null),
    enabled: open,
    staleTime: 30_000,
  });

  const results = queryResult?.profiles ?? [];

  // Contacts matching search
  const contactMatches = contacts
    .filter(p => p.type === "performer" || p.type === "artist")
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  // Deduplicate: remove global profiles already in contacts
  const contactNames = new Set(contactMatches.map(p => p.name.toLowerCase()));
  const uniqueProfiles = results.filter(
    p => !contactNames.has(p.name.toLowerCase()),
  );

  const hasContacts = contactMatches.length > 0;
  const hasProfiles = uniqueProfiles.length > 0;
  const hasResults = hasContacts || hasProfiles;

  return (
    <Combobox
      value={search}
      onValueChange={(v) => {
        setSearch(v);
        onChange(v, undefined);
      }}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
    >
      {/* User's own contacts */}
      {hasContacts && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Contact className="h-3 w-3" />
            My contacts
          </div>
          {contactMatches.map(p => {
            // If the contact matches a global profile, pass it so the profile ID is captured
            const matchingProfile = results.find(
              r => r.name.toLowerCase() === p.name.toLowerCase(),
            );
            return (
            <ComboboxOption
              key={p.id}
              selected={p.name === value}
              onSelect={() => {
                onChange(p.name, matchingProfile);
                setSearch(p.name);
                setOpen(false);
              }}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {p.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{p.name}</p>
                {p.contacts[0]?.email && (
                  <p className="text-xs text-muted-foreground truncate">{p.contacts[0].email}</p>
                )}
              </div>
            </ComboboxOption>
            );
          })}
        </>
      )}

      {/* Global artist profiles */}
      {loading ? (
        <ComboboxLoading>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </ComboboxLoading>
      ) : hasProfiles ? (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 border-t">
            <Music className="h-3 w-3" />
            Public profiles
          </div>
          {uniqueProfiles.map((profile) => (
            <ComboboxOption
              key={profile.id}
              selected={profile.name === value}
              onSelect={() => {
                onChange(profile.name, profile);
                setSearch(profile.name);
                setOpen(false);
              }}
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={profile.avatarUrl} alt={profile.name} />
                <AvatarFallback className="text-xs bg-muted">
                  {profile.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{profile.name}</p>
                {getPrimaryLocation(profile.locations) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {formatLocation(getPrimaryLocation(profile.locations))}
                  </p>
                )}
              </div>
              {profile.genres && profile.genres.length > 0 && (
                <span className="hidden sm:block text-xs text-muted-foreground truncate max-w-[90px] shrink-0">
                  {profile.genres.slice(0, 2).join(", ")}
                </span>
              )}
            </ComboboxOption>
          ))}
        </>
      ) : null}

      {/* Empty state */}
      {!hasResults && !loading && (
        <ComboboxEmpty>
          <Music className="h-5 w-5 opacity-40" />
          <p className="text-sm">
            {search.trim() ? `No performers found for "${search.trim()}"` : "No public artist profiles yet"}
          </p>
          <p className="text-xs">Type a name to use it as-is</p>
        </ComboboxEmpty>
      )}
    </Combobox>
  );
}
