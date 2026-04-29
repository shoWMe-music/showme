import { useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarItem, CalendarItemType, calendarItemTypeLabels, type Event as AppEvent } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Eye, Trash2, Edit2, Copy, Printer, Users, ExternalLink,
} from "lucide-react";
import { PopupItemType } from "./calendarConstants";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";

// ── Item Popup (Google Calendar-style) ──

export function CalendarItemPopup({ item, position, onClose, onDelete, onDuplicate, onEdit, onInvite, onPrint, onPublish, entityColor, holdRank, holdAutoPromote, onHoldRankChange, onHoldAutoPromoteChange, onConfirmHold, onDeclineHold }: {
  item: PopupItemType;
  position: { x: number; y: number };
  onClose: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onInvite?: () => void;
  onPrint?: () => void;
  onPublish?: () => void;
  entityColor?: string;
  holdRank?: number;
  holdAutoPromote?: boolean;
  onHoldRankChange?: (rank: number) => void;
  onHoldAutoPromoteChange?: (auto: boolean) => void;
  onConfirmHold?: () => void;
  onDeclineHold?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target)) {
        const radixPopper = (target as HTMLElement).closest?.("[data-radix-popper-content-wrapper]");
        if (radixPopper) return;
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", escHandler); };
  }, [onClose]);

  const isEvent = item.kind === "event";
  const title = isEvent ? item.data.name : item.data.title;
  const subtitle = isEvent ? null : (item.data.description || "");
  const dateStr = isEvent ? item.data.date : item.data.date;
  const timeStr = !isEvent ? [(item.data as CalendarItem).startTime, (item.data as CalendarItem).endTime].filter(Boolean).join(" – ") : "";
  const typeBadge = isEvent ? item.data.eventStatus : (item.data as CalendarItem).type;
  const isPublished = isEvent && (item.data as AppEvent).published;

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(position.x, window.innerWidth - 320),
    top: Math.min(position.y, window.innerHeight - 350),
    zIndex: 100,
  };

  return (
    <div ref={ref} style={style} className="w-[300px] rounded-xl border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex items-start gap-2">
          {entityColor && <span className="h-3 w-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: entityColor }} />}
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-sm truncate">{title}</h3>
            {isEvent && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                <ProfilePreviewPopover name={(item.data as AppEvent).artist} profileId={(item.data as AppEvent).performerProfileId} /> · <ProfilePreviewPopover name={(item.data as AppEvent).venue} />
              </p>
            )}
            {!isEvent && subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {isEvent ? typeBadge : calendarItemTypeLabels[typeBadge as CalendarItemType]}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground mb-3">
        {dateStr}{timeStr && ` · ${timeStr}`}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {isEvent && (
          <Button variant="ghost" size="sm" className="h-8 text-xs flex-col gap-0.5 px-1" onClick={() => { onClose(); navigate({ to: "/events/$id", params: { id: item.data.id } }); }}>
            <Eye className="h-3.5 w-3.5" /><span>View</span>
          </Button>
        )}
        {onEdit && (
          <Button variant="ghost" size="sm" className="h-8 text-xs flex-col gap-0.5 px-1" onClick={() => { onClose(); onEdit(); }}>
            <Edit2 className="h-3.5 w-3.5" /><span>Edit</span>
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="sm" className="h-8 text-xs flex-col gap-0.5 px-1 text-destructive hover:text-destructive" onClick={() => { onDelete(); onClose(); }}>
            <Trash2 className="h-3.5 w-3.5" /><span>Delete</span>
          </Button>
        )}
        {onDuplicate && (
          <Button variant="ghost" size="sm" className="h-8 text-xs flex-col gap-0.5 px-1" onClick={() => { onDuplicate(); onClose(); }}>
            <Copy className="h-3.5 w-3.5" /><span>Duplicate</span>
          </Button>
        )}
        {isEvent && onPrint && (
          <Button variant="ghost" size="sm" className="h-8 text-xs flex-col gap-0.5 px-1" onClick={() => { onClose(); onPrint(); }}>
            <Printer className="h-3.5 w-3.5" /><span>Print</span>
          </Button>
        )}
        {isEvent && onPublish && (
          <Button variant="ghost" size="sm" className="h-8 text-xs flex-col gap-0.5 px-1" onClick={() => { onPublish(); onClose(); }}>
            <ExternalLink className="h-3.5 w-3.5" /><span>{isPublished ? "Un-publish" : "Publish"}</span>
          </Button>
        )}
        {isEvent && (
          <Button variant="ghost" size="sm" className="h-8 text-xs flex-col gap-0.5 px-1" onClick={() => {
            onClose();
            onInvite?.();
          }}>
            <Users className="h-3.5 w-3.5" /><span>Invite</span>
          </Button>
        )}
      </div>
      {/* Hold settings for on_hold events */}
      {isEvent && (item.data as AppEvent).eventStatus === "on_hold" && onHoldRankChange && (
        <div className="border-t mt-3 pt-3 space-y-2">
          <p className="text-[10px] uppercase font-medium text-muted-foreground">Hold Settings</p>
          <div className="flex items-center gap-2">
            <Label className="text-xs min-w-[60px]">Rank</Label>
            <Select value={String(holdRank || 1)} onValueChange={(v) => onHoldRankChange(Number(v))}>
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {[1, 2, 3, 4, 5].map(n => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={holdAutoPromote !== false} onCheckedChange={(v) => onHoldAutoPromoteChange?.(v)} className="h-4 w-7" />
            <Label className="text-xs">Auto-promote when higher hold removed</Label>
          </div>
          {(onConfirmHold || onDeclineHold) && (
            <div className="flex items-center gap-2 pt-1">
              {onConfirmHold && (
                <Button variant="default" size="sm" className="h-7 text-xs gap-1" onClick={() => { onConfirmHold(); onClose(); }}>
                  Accept date
                </Button>
              )}
              {onDeclineHold && (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => { onDeclineHold(); onClose(); }}>
                  Decline
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
