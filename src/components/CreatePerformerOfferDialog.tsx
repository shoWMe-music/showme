import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  Building2,
  CalendarPlus,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { searchVenueProfiles, type VenueProfileResult } from "@/lib/db";
import { queryKeys } from "@/lib/queries";
import { formatLocation, type SharedProfile } from "@/lib/user-context";
import {
  getMissingPerformerFields,
  performerFieldLabel,
} from "@/lib/profileCompleteness";
import {
  FREE_ARTIST_OFFER_MONTHLY_CAP,
  isPaidPlan,
  useProfilePlan,
} from "@/lib/plans";

const PITCH_MIN = 20;
const PITCH_MAX = 2000;
const ADDITIONAL_DATES_MAX = 5;

interface CreatePerformerOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  performerProfile: SharedProfile;
}

interface OfferResult {
  requestId: string;
  sentVia: "in_platform" | "mailto";
  subject?: string;
  mailtoBody?: string;
  htmlBody?: string;
  claimUrl?: string;
}

export default function CreatePerformerOfferDialog({
  open,
  onOpenChange,
  performerProfile,
}: CreatePerformerOfferDialogProps) {
  const queryClient = useQueryClient();
  const performerProfileId = performerProfile.id ?? "";

  // ── Profile completeness gate (mirrors the server check) ────────────────
  const missingFields = useMemo(
    () => getMissingPerformerFields(performerProfile),
    [performerProfile],
  );
  const profileIncomplete = missingFields.length > 0;

  // ── Rate limit display ──────────────────────────────────────────────────
  const { plan } = useProfilePlan(performerProfileId);
  const planType = plan?.type ?? "free_artist";
  const offerLimited = !isPaidPlan(planType);
  const currentMonthKey = (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const sentThisMonth =
    plan?.offerCountMonthKey === currentMonthKey ? plan?.offerCountThisMonth ?? 0 : 0;
  const remainingOffers = Math.max(0, FREE_ARTIST_OFFER_MONTHLY_CAP - sentThisMonth);
  const atCap = offerLimited && remainingOffers <= 0;

  // ── Form state ───────────────────────────────────────────────────────────
  const [targetMode, setTargetMode] = useState<"search" | "email">("search");
  const [venueSearch, setVenueSearch] = useState("");
  const [debouncedVenueSearch, setDebouncedVenueSearch] = useState("");
  const [selectedVenue, setSelectedVenue] = useState<VenueProfileResult | null>(null);
  const [venueEmail, setVenueEmail] = useState("");
  const [venueName, setVenueName] = useState("");

  const [wantedDate, setWantedDate] = useState("");
  const [additionalDates, setAdditionalDates] = useState<string[]>([]);
  const [feeMin, setFeeMin] = useState("");
  const [feeMax, setFeeMax] = useState("");
  const [pitch, setPitch] = useState("");

  const [result, setResult] = useState<OfferResult | null>(null);
  const [htmlCopied, setHtmlCopied] = useState(false);

  // Reset everything when the dialog reopens.
  useEffect(() => {
    if (!open) return;
    setTargetMode("search");
    setVenueSearch("");
    setSelectedVenue(null);
    setVenueEmail("");
    setVenueName("");
    setWantedDate("");
    setAdditionalDates([]);
    setFeeMin("");
    setFeeMax("");
    setPitch("");
    setResult(null);
    setHtmlCopied(false);
  }, [open]);

  // Debounce the venue search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedVenueSearch(venueSearch), 250);
    return () => clearTimeout(t);
  }, [venueSearch]);

  const { data: venueResults, isPending: searching } = useQuery<VenueProfileResult[]>({
    queryKey: queryKeys.bookingRequests({
      kind: "venueSearch",
      term: debouncedVenueSearch,
    }),
    enabled: open && targetMode === "search" && debouncedVenueSearch.length >= 2 && !selectedVenue,
    queryFn: () => searchVenueProfiles(debouncedVenueSearch, 8),
    staleTime: 30_000,
  });

  // ── Submit ───────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async (): Promise<OfferResult> => {
      const fn = httpsCallable<
        {
          performerProfileId: string;
          targetProfileId?: string;
          venueEmail?: string;
          venueName?: string;
          wantedDate: string;
          additionalDates?: string[];
          feeMin?: number | null;
          feeMax?: number | null;
          pitch: string;
        },
        OfferResult
      >(getFirebaseFunctions(), "createPerformerOffer");
      const min = feeMin.trim() ? Number(feeMin) : null;
      const max = feeMax.trim() ? Number(feeMax) : null;
      const payload = {
        performerProfileId,
        wantedDate,
        additionalDates,
        feeMin: Number.isFinite(min) ? min : null,
        feeMax: Number.isFinite(max) ? max : null,
        pitch: pitch.trim(),
        ...(targetMode === "search" && selectedVenue
          ? { targetProfileId: selectedVenue.id }
          : { venueEmail: venueEmail.trim().toLowerCase(), venueName: venueName.trim() }),
      };
      const res = await fn(payload);
      return res.data;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["sentBookingRequests"] });
      setResult(res);
      if (res.sentVia === "in_platform") {
        toast({
          title: "Offer sent",
          description: "It'll appear in the venue's incoming requests.",
        });
        onOpenChange(false);
      }
      // For "mailto" we keep the dialog open with the preview pane — see below.
    },
    onError: (err: Error) => {
      toast({
        title: "Could not send offer",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ── Validation ───────────────────────────────────────────────────────────
  const validVenue =
    (targetMode === "search" && !!selectedVenue) ||
    (targetMode === "email" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(venueEmail.trim()) &&
      !!venueName.trim());
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(wantedDate);
  const validPitch = pitch.trim().length >= PITCH_MIN && pitch.trim().length <= PITCH_MAX;
  const canSubmit =
    !profileIncomplete &&
    !atCap &&
    validVenue &&
    validDate &&
    validPitch &&
    !mutation.isPending;

  // ── Render ───────────────────────────────────────────────────────────────
  if (result?.sentVia === "mailto") {
    return (
      <MailtoPreviewPane
        open={open}
        onOpenChange={onOpenChange}
        result={result}
        venueEmail={venueEmail}
        venueName={venueName}
        htmlCopied={htmlCopied}
        setHtmlCopied={setHtmlCopied}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!mutation.isPending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send an offer</DialogTitle>
          <DialogDescription>
            Pitch a venue to play a show. If they&apos;re on shoWMe, the offer lands in their
            incoming requests. If not, we&apos;ll generate a template email for you to send
            from your own inbox.
          </DialogDescription>
        </DialogHeader>

        {profileIncomplete && (
          <ProfileGateNotice
            performerProfileId={performerProfileId}
            missingFields={missingFields}
            onOpenChange={onOpenChange}
          />
        )}

        {offerLimited && !profileIncomplete && (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-xs flex items-center justify-between gap-3",
              atCap
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : remainingOffers <= 5
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
                  : "border-border bg-muted/30 text-muted-foreground",
            )}
          >
            <span>
              {atCap
                ? `You've reached the ${FREE_ARTIST_OFFER_MONTHLY_CAP}/month free offer limit. Resets on the 1st.`
                : `${remainingOffers} of ${FREE_ARTIST_OFFER_MONTHLY_CAP} offers remaining this month`}
            </span>
          </div>
        )}

        <fieldset disabled={profileIncomplete || atCap || mutation.isPending} className="space-y-4">
          {/* Target picker */}
          <div className="space-y-2">
            <Label className="text-xs">Venue *</Label>
            <div className="flex gap-1 rounded-md border bg-muted p-0.5 text-xs">
              <button
                type="button"
                onClick={() => { setTargetMode("search"); setSelectedVenue(null); }}
                className={cn(
                  "flex-1 rounded px-2 py-1 transition-colors",
                  targetMode === "search" ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                <Search className="h-3 w-3 inline mr-1" /> Search on shoWMe
              </button>
              <button
                type="button"
                onClick={() => setTargetMode("email")}
                className={cn(
                  "flex-1 rounded px-2 py-1 transition-colors",
                  targetMode === "email" ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                <Mail className="h-3 w-3 inline mr-1" /> Email a venue
              </button>
            </div>

            {targetMode === "search" ? (
              <VenueSearchField
                venueSearch={venueSearch}
                onVenueSearchChange={setVenueSearch}
                selectedVenue={selectedVenue}
                onSelect={setSelectedVenue}
                onClear={() => { setSelectedVenue(null); setVenueSearch(""); }}
                results={venueResults ?? []}
                searching={searching && debouncedVenueSearch.length >= 2}
              />
            ) : (
              <div className="space-y-2">
                <Input
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  placeholder="Venue name"
                />
                <Input
                  type="email"
                  value={venueEmail}
                  onChange={(e) => setVenueEmail(e.target.value)}
                  placeholder="contact@venue.com"
                />
                <p className="text-[11px] text-muted-foreground">
                  We&apos;ll create a placeholder venue and generate an email template
                  you can send from your own inbox. The venue can claim the placeholder
                  when they sign up.
                </p>
              </div>
            )}
          </div>

          {/* Date + additional dates */}
          <div className="space-y-2">
            <Label className="text-xs">Proposed date *</Label>
            <Input
              type="date"
              value={wantedDate}
              onChange={(e) => setWantedDate(e.target.value)}
            />
            {additionalDates.length > 0 && (
              <div className="space-y-1.5">
                {additionalDates.map((d, i) => (
                  <div key={`${d}-${i}`} className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={d}
                      onChange={(e) => {
                        const next = [...additionalDates];
                        next[i] = e.target.value;
                        setAdditionalDates(next);
                      }}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setAdditionalDates(additionalDates.filter((_, j) => j !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {additionalDates.length < ADDITIONAL_DATES_MAX && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={() => setAdditionalDates([...additionalDates, ""])}
              >
                <CalendarPlus className="h-3 w-3" /> Add alternative date
              </Button>
            )}
          </div>

          {/* Fee */}
          <div className="space-y-2">
            <Label className="text-xs">Fee (€)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={feeMin}
                onChange={(e) => setFeeMin(e.target.value)}
                placeholder="Min"
                className="w-32"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={feeMax}
                onChange={(e) => setFeeMax(e.target.value)}
                placeholder="Max (optional)"
                className="w-32"
              />
              <p className="text-[11px] text-muted-foreground ml-1">Leave blank for &ldquo;open to discussion&rdquo;.</p>
            </div>
          </div>

          {/* Pitch */}
          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs">Pitch *</Label>
              <span
                className={cn(
                  "text-[10px]",
                  pitch.length > PITCH_MAX ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {pitch.length}/{PITCH_MAX}
              </span>
            </div>
            <Textarea
              rows={6}
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              placeholder="Why this venue, what kind of show you'd put on, draw or context that's relevant…"
              className="text-sm"
            />
            {pitch.trim().length > 0 && pitch.trim().length < PITCH_MIN && (
              <p className="text-[11px] text-amber-600">
                Add at least {PITCH_MIN - pitch.trim().length} more characters.
              </p>
            )}
          </div>
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit} className="gap-1.5">
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Send className="h-3.5 w-3.5" /> Send offer
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileGateNotice({
  performerProfileId,
  missingFields,
  onOpenChange,
}: {
  performerProfileId: string;
  missingFields: string[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="flex items-start gap-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> Complete your profile to send
      </p>
      <p className="mt-1 leading-snug">
        Venues see your shoWMe profile when they review your offer. Add the missing pieces so the offer has a chance:
      </p>
      <ul className="mt-1.5 ml-5 list-disc space-y-0.5">
        {missingFields.map((f) => (
          <li key={f}>{performerFieldLabel(f as Parameters<typeof performerFieldLabel>[0])}</li>
        ))}
      </ul>
      {performerProfileId && (
        <Link
          to="/profiles/$profileId/edit"
          params={{ profileId: performerProfileId }}
          className="mt-2 inline-block font-medium underline underline-offset-2"
          onClick={() => onOpenChange(false)}
        >
          Edit my profile →
        </Link>
      )}
    </div>
  );
}

function VenueSearchField({
  venueSearch,
  onVenueSearchChange,
  selectedVenue,
  onSelect,
  onClear,
  results,
  searching,
}: {
  venueSearch: string;
  onVenueSearchChange: (v: string) => void;
  selectedVenue: VenueProfileResult | null;
  onSelect: (v: VenueProfileResult) => void;
  onClear: () => void;
  results: VenueProfileResult[];
  searching: boolean;
}) {
  if (selectedVenue) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{selectedVenue.name}</p>
            {selectedVenue.locations && selectedVenue.locations.length > 0 && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3" />
                {formatLocation(selectedVenue.locations[0])}
              </p>
            )}
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        value={venueSearch}
        onChange={(e) => onVenueSearchChange(e.target.value)}
        placeholder="Search venues on shoWMe…"
      />
      {venueSearch.length < 2 ? (
        <p className="text-[11px] text-muted-foreground">Type at least 2 characters to search.</p>
      ) : searching ? (
        <div className="space-y-1.5">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : results.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No public venues match. Switch to &ldquo;Email a venue&rdquo; to pitch a venue that&apos;s not on shoWMe.
        </p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border bg-card">
          {results.map((v) => (
            <button
              type="button"
              key={v.id}
              onClick={() => onSelect(v)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/60 transition-colors text-left"
            >
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{v.name}</p>
                {v.locations && v.locations.length > 0 && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {formatLocation(v.locations[0])}
                  </p>
                )}
              </div>
              {v.locations?.[0]?.country && (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {v.locations[0].country}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── mailto: preview pane ────────────────────────────────────────────────────

function MailtoPreviewPane({
  open,
  onOpenChange,
  result,
  venueEmail,
  venueName,
  htmlCopied,
  setHtmlCopied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: OfferResult;
  venueEmail: string;
  venueName: string;
  htmlCopied: boolean;
  setHtmlCopied: (v: boolean) => void;
}) {
  const subject = result.subject ?? "";
  const body = result.mailtoBody ?? "";
  const html = result.htmlBody ?? "";

  const mailtoUrl =
    `mailto:${encodeURIComponent(venueEmail)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  const copyHtml = async () => {
    try {
      // ClipboardItem with both text/html and text/plain — paste into Gmail
      // or Outlook web preserves formatting, fallback to plain text in other
      // clients (Apple Mail, iOS Mail, Safari clipboard restrictions).
      if (
        typeof window !== "undefined" &&
        window.navigator?.clipboard?.write &&
        typeof ClipboardItem !== "undefined"
      ) {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([body], { type: "text/plain" }),
        });
        await window.navigator.clipboard.write([item]);
      } else {
        await window.navigator.clipboard.writeText(body);
      }
      setHtmlCopied(true);
      toast({ title: "Copied", description: "Paste into your email's compose window." });
      setTimeout(() => setHtmlCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy automatically",
        description: "Select the preview text below and copy manually.",
        variant: "destructive",
      });
    }
  };

  const openMailto = () => {
    window.location.href = mailtoUrl;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send your offer email</DialogTitle>
          <DialogDescription>
            {venueName ? `${venueName} isn't on shoWMe yet.` : "This venue isn't on shoWMe yet."} We&apos;ve
            created a placeholder for them and saved your offer to <strong>Sent Requests</strong>.
            Send the email from your own inbox so the reply lands with you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-card px-3 py-2 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">To</span>
              <span className="font-medium truncate">{venueEmail}</span>
            </div>
            <div className="flex justify-between gap-2 mt-1">
              <span className="text-muted-foreground">Subject</span>
              <span className="font-medium truncate">{subject}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Preview</Label>
            <pre className="rounded-md border bg-muted/40 px-3 py-2.5 text-[12px] whitespace-pre-wrap font-mono max-h-72 overflow-y-auto">
              {body}
            </pre>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={openMailto} className="gap-1.5 flex-1">
              <ExternalLink className="h-3.5 w-3.5" /> Open in email
            </Button>
            <Button onClick={copyHtml} variant="outline" className="gap-1.5 flex-1">
              {htmlCopied ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy formatted version
                </>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            &ldquo;Copy formatted version&rdquo; preserves styling when pasted into Gmail or Outlook web. Other clients
            may fall back to plain text.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
