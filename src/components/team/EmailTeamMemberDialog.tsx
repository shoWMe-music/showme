/**
 * Email a single team member from any team-management surface.
 *
 * The recipient field is read-only (the team member's email from their card).
 * The dialog handles the empty-email guard at the call site so this component
 * can stay focused on collecting subject + body. On send, the message is
 * delivered via the `sendTeamMemberEmail` callable; the signed-in user's
 * email is set as Reply-To so replies route back to them.
 */

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { getFirebaseFunctions } from "@/integrations/firebase/app";

export interface EmailTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientName: string;
  recipientEmail: string;
}

export default function EmailTeamMemberDialog({ open, onOpenChange, recipientName, recipientEmail }: EmailTeamMemberDialogProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // Reset form whenever the dialog opens for a new recipient.
  useEffect(() => {
    if (open) {
      setSubject("");
      setBody("");
      setSending(false);
    }
  }, [open, recipientEmail]);

  const handleSend = async () => {
    setSending(true);
    try {
      const fn = httpsCallable<
        { recipientEmail: string; recipientName: string; subject: string; body: string },
        { ok: true }
      >(getFirebaseFunctions(), "sendTeamMemberEmail");
      await fn({
        recipientEmail,
        recipientName,
        subject: subject.trim(),
        body: body.trim(),
      });
      toast({
        title: "Email sent",
        description: `Sent "${subject}" to ${recipientEmail}.`,
      });
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to send team-member email:", err);
      toast({
        title: "Failed to send email",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setSending(false);
    }
  };

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && !sending;

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
              disabled={sending}
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
              disabled={sending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={!canSend}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
