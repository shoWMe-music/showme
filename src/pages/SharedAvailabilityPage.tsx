import { useState, useMemo } from "react";
import { useParams, Link } from "@tanstack/react-router";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, isSameMonth, isToday, parseISO, isBefore, isAfter,
  differenceInMonths,
} from "date-fns";
import { ArrowLeft, Info, CalendarCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import RequestDateForm from "@/components/RequestDateForm";

export default function SharedAvailabilityPage() {
  const { shareId } = useParams({ from: "/availability/$shareId" });

  const [requestOpen, setRequestOpen] = useState(false);
  const [requestDate, setRequestDate] = useState("");

  const data = useMemo(() => {
    if (!shareId) return null;
    try {
      return JSON.parse(atob(decodeURIComponent(shareId))) as {
        from: string | null;
        to: string | null;
        unavailable: string[];
        generated: string;
        profileSlug?: string;
        profileId?: string;
        profileRole?: string;
        ownerUid?: string | null;
      };
    } catch { return null; }
  }, [shareId]);

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8">
        <p className="text-lg text-muted-foreground">Invalid or expired availability link.</p>
        <Link to="/" className="mt-4 text-primary hover:underline text-sm">Go home</Link>
      </div>
    );
  }

  const unavailableSet = new Set(data.unavailable);
  const generated = parseISO(data.generated);
  const from = data.from ? parseISO(data.from) : null;
  const to = data.to ? parseISO(data.to) : null;

  const baseMonth = from || generated;
  const monthCount = from && to ? Math.max(differenceInMonths(to, from) + 1, 1) : 3;
  const months = Array.from({ length: monthCount }, (_, i) => {
    const month = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, 1);
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days: Date[] = [];
    let day = calStart;
    while (day <= calEnd) { days.push(day); day = addDays(day, 1); }
    return { month, days };
  });

  const weekDays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="text-2xl font-bold font-display mb-1">Calendar Availability</h1>
        <p className="text-sm text-muted-foreground mb-2">
          {from && to ? `${format(from, "MMM d, yyyy")} — ${format(to, "MMM d, yyyy")}` : "All availability"}
        </p>

        <div className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground mb-6 flex items-start gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Shared on {format(generated, "PPpp")}</p>
            <p className="mt-0.5">This availability was shared on the date above. It may have changed since then.</p>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-4 w-4 rounded bg-background border" /> Available</span>
          <span className="flex items-center gap-1.5"><span className="h-4 w-4 rounded bg-destructive/10 border border-destructive/20" /> Unavailable</span>
        </div>

        {data.profileSlug && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground mb-6 flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 shrink-0 text-primary" />
            <span>Select your desired date, fill the request form and send.</span>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {months.map(({ month, days }) => (
            <div key={month.toISOString()} className="rounded-xl border bg-card p-4">
              <h2 className="font-display font-semibold text-sm mb-3 text-center">{format(month, "MMMM yyyy")}</h2>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {weekDays.map(d => <div key={d} className="text-[10px] text-center font-medium text-muted-foreground">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((day, i) => {
                  const dateKey = format(day, "yyyy-MM-dd");
                  const inMonth = isSameMonth(day, month);
                  const isUnavail = unavailableSet.has(dateKey);
                  const inRange = (!from || !isBefore(day, from)) && (!to || !isAfter(day, to));
                  const today = isToday(day);
                  const isAvailable = inMonth && inRange && !isUnavail;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "h-8 flex items-center justify-center rounded text-xs cursor-default",
                        !inMonth && "text-muted-foreground/30",
                        inMonth && inRange && isUnavail && "bg-destructive/10 text-destructive border border-destructive/20",
                        isAvailable && "bg-background border hover:bg-primary/5 cursor-pointer",
                        inMonth && !inRange && "text-muted-foreground/40",
                        today && "ring-1 ring-primary",
                      )}
                      onClick={() => {
                        if (isAvailable && data.profileSlug) {
                          setRequestDate(dateKey.split("-").reverse().map(p => p.slice(-2)).join("/"));
                          setRequestOpen(true);
                        }
                      }}
                      title={isAvailable && data.profileSlug ? "Click to request this date" : undefined}
                    >
                      {format(day, "d")}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {data.profileSlug && (
          <RequestDateForm
            open={requestOpen}
            onOpenChange={setRequestOpen}
            targetProfileSlug={data.profileSlug}
            targetProfileId={data.profileId}
            targetRole={data.profileRole || "venue"}
            source="availability"
            defaultDate={requestDate}
            operatorOwnerUid={data.ownerUid || ""}
          />
        )}
      </div>
    </div>
  );
}
