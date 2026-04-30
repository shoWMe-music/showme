/**
 * Email a single team member from any team-management surface.
 *
 * The recipient field is read-only (the team member's email from their card).
 * The dialog handles the empty-email guard at the call site so this component
 * can stay focused on collecting subject + body.
 *
 * Send infra: this wave does not yet have a "send arbitrary email to a team
 * member" callable. We surface a TODO in the toast text on submit so users
 * know the message wasn't sent — the UI is wired and can be hooked into a
 * future callable function with a one-line change inside `handleSend`.
 */

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

export interface EmailTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientName: string;
  recipientEmail: string;
}

export default function EmailTeamMemberDialog({ open, onOpenChange, recipientName, recipientEmail }: EmailTeamMemberDialogProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Reset form whenever the dialog opens for a new recipient.
  useEffect(() => {
    if (open) {
      setSubject("");
      setBody("");
    }
  }, [open, recipientEmail]);

  const handleSend = () => {
    // Send infra placeholder. When the email-team-member callable lands,
    // wire it here and remove the toast description disclaimer below.
    toast({
      title: "Email queued",
      description: `Send not yet wired. Would send "${subject}" to ${recipientEmail}.`,
    });
    onOpenChange(false);
  };

  const canSend = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Email {recipientName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <Label>To</Label>
            <Input value={recipientEmail} readOnly className="mt-1 bg-muted/30 text-muted-foreground" />
          </div>
          <div>
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject…"
              className="mt-1"
              data-testid="email-subject-input"
            />
          </div>
          <div>
            <Label>Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message…"
              className="mt-1 min-h-[160px]"
              data-testid="email-body-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={!canSend}>Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
