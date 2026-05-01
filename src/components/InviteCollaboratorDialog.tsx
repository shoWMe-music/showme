import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Copy, Users, Loader2, Check, CheckCircle2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast, copyToast } from "@/hooks/use-toast";
import { legacyRoleToEventRole, type EventCollaboratorRole, type ContactPerson } from "@/lib/models";
import { useContacts } from "@/lib/queries";
import { useMyInvitationCodes } from "@/lib/queries/useInvitationCodes";
import { useAddContact } from "@/lib/queries/useContactMutations";
import { useAuth } from "@/lib/auth-context";
import { createPerformerInvitation, sendPerformerInvitationEmail } from "@/lib/createPerformerInvitation";

type Permission = "admin" | "editor" | "view_only";

const permissionLabels: Record<Permission, string> = {
  admin: "Admin",
  editor: "Editor",
  view_only: "View only",
};

const permissionDescriptions: Record<Permission, string> = {
  admin: "Full access — can edit, invite others, and manage settings",
  editor: "Can edit event details and financials",
  view_only: "Can only view event information",
};

function inviteToEventRole(roleLabel: string, permission: Permission): EventCollaboratorRole {
  if (permission === "admin") return "admin";
  return legacyRoleToEventRole(roleLabel);
}

interface InviteCollaboratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventName?: string;
  eventId?: string;
  defaultEmail?: string;
  defaultRole?: string;
  defaultName?: string;
  onCollaboratorAdded?: () => void;
  restrictToViewOnly?: boolean;
}

export default function InviteCollaboratorDialog({ open, onOpenChange, eventName, eventId, defaultEmail, defaultRole, defaultName, onCollaboratorAdded, restrictToViewOnly }: InviteCollaboratorDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(defaultRole || "Performer");
  const [permission, setPermission] = useState<Permission>(restrictToViewOnly ? "view_only" : "editor");
  const [customRoleName, setCustomRoleName] = useState("");
  const [message, setMessage] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [showContactSuggestions, setShowContactSuggestions] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [sentName, setSentName] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [sentRole, setSentRole] = useState("");
  const emailContainerRef = useRef<HTMLDivElement>(null);

  const { user } = useAuth();
  const contacts = useContacts();
  const queryClient = useQueryClient();
  const { data: myInvitationCodes } = useMyInvitationCodes();
  const addContactMutation = useAddContact();

  const roles = ["Performer", "Venue", "Promoter", "Organizer", "Agent", "Manager", "Custom"];

  // Collect all contact emails from contacts
  const contactSuggestions = contacts.flatMap(p =>
    (p.contacts || [])
      .filter((c: ContactPerson) => c.email)
      .map((c: ContactPerson) => ({ name: c.name || p.name, email: c.email, contactName: p.name }))
  );

  const filteredSuggestions = email.trim()
    ? contactSuggestions.filter(c =>
        c.email.toLowerCase().includes(email.toLowerCase()) ||
        c.name.toLowerCase().includes(email.toLowerCase())
      )
    : contactSuggestions;

  // Reset form state only when the dialog transitions open. Putting downstream
  // data (like myInvitationCodes) in deps caused the freshly-generated link to
  // be wiped after invalidation, which made the next click re-fire generateInvite
  // and create duplicate collaborators.
  useEffect(() => {
    if (!open) return;
    setEmail(defaultEmail || "");
    setRole(defaultRole || "Performer");
    setPermission(restrictToViewOnly ? "view_only" : "editor");
    setCustomRoleName("");
    setMessage("");
    setShowContactSuggestions(false);
    setGenerating(false);
    setSending(false);
    setShowSuccess(false);
    setSentName("");
    setSentEmail("");
    setSentRole("");
    setGeneratedLink("");
    setInvitationCode("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on open
  }, [open]);

  // Hydrate from an existing invitation code if one matches. Idempotent: only
  // sets state, never clears it, so a link generated this session survives a
  // myInvitationCodes refetch.
  useEffect(() => {
    if (!open || !defaultName) return;
    const existing = myInvitationCodes?.find(
      (ic) =>
        ic.status === "active" &&
        ic.linkedEventId === eventId &&
        ic.recipientName === defaultName,
    );
    if (existing) {
      setInvitationCode(existing.code);
      setGeneratedLink(`${window.location.origin}/signup?code=${existing.code}`);
      if (existing.recipientEmail) setEmail(existing.recipientEmail);
    }
  }, [open, eventId, defaultName, myInvitationCodes]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emailContainerRef.current && !emailContainerRef.current.contains(e.target as Node)) {
        setShowContactSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const effectivePermission: Permission = restrictToViewOnly ? "view_only" : permission;

  const generateInvite = async () => {
    if (!eventId || !user) return null;
    const roleLabel = role === "Custom" ? customRoleName || "Custom" : role;
    const eventRole = inviteToEventRole(roleLabel, effectivePermission);
    const displayName = defaultName || email.trim().split("@")[0];

    const result = await createPerformerInvitation({
      eventId,
      email: email.trim(),
      displayName,
      userUid: user.uid,
      queryClient,
      role: roleLabel,
      eventRole,
      permission: effectivePermission,
      message: message.trim(),
      onCollaboratorAdded,
    });

    if (!result) {
      toast({ title: "Error", description: "Failed to generate invitation.", variant: "destructive" });
      return null;
    }

    setInvitationCode(result.code);
    setGeneratedLink(result.url);
    return { url: result.url, code: result.code };
  };

  const handleCopyLink = async () => {
    if (generatedLink) {
      await navigator.clipboard.writeText(generatedLink);
      copyToast("Link copied", "Collaboration link copied to clipboard.");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateInvite();
      if (!result) return;
      await navigator.clipboard.writeText(result.url);
      copyToast("Link copied", "Collaboration link copied to clipboard.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyCode = () => {
    if (invitationCode) {
      navigator.clipboard.writeText(invitationCode);
      copyToast("Invitation code copied");
    }
  };

  const handleSendEmail = async () => {
    setSending(true);
    try {
      const result = generatedLink ? { url: generatedLink, code: invitationCode } : await generateInvite();
      if (!result) {
        setSending(false);
        return;
      }

      await sendPerformerInvitationEmail({
        code: result.code || "",
        recipientEmail: email.trim(),
        recipientName: defaultName || email.trim().split("@")[0],
        eventName: eventName || undefined,
        senderName: user?.displayName || user?.email || "A shoWMe user",
        message: message.trim() || undefined,
      });

      const roleLabel = role === "Custom" ? customRoleName || "Custom" : role;
      toast({
        title: "Invitation sent",
        description: `Invited ${email} as ${roleLabel} (${permissionLabels[effectivePermission]})${eventName ? ` for ${eventName}` : ""}`,
      });

      setSentName(defaultName || email.trim().split("@")[0]);
      setSentEmail(email.trim());
      setSentRole(roleLabel.toLowerCase());
      setShowSuccess(true);
    } finally {
      setSending(false);
    }
  };

  const isValid = email.trim() && (role !== "Custom" || customRoleName.trim());

  const handleCreateContact = () => {
    addContactMutation.mutate({
      contact: {
        id: `P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: sentName,
        type: sentRole,
        contacts: [{ name: sentName, email: sentEmail, phone: "" }],
        iban: "",
        bankName: "",
        vatId: "",
        address: "",
        notes: "",
      },
    });
    toast({ title: "Contact created", description: `${sentName} has been added to your contacts.` });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        {showSuccess ? (
          <>
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div className="text-center space-y-1">
                <h3 className="text-lg font-semibold">Invitation sent to {sentName}</h3>
                <p className="text-sm text-muted-foreground">{sentEmail}</p>
              </div>
              <div className="w-full rounded-lg border bg-muted/50 p-4 space-y-3 mt-2">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">Create a contact for {sentName}?</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Save {sentName} to your contacts so you can easily find them later.
                </p>
                <div className="flex gap-2">
                  <Button onClick={handleCreateContact} className="flex-1 gap-2">
                    <UserPlus className="h-4 w-4" /> Yes, create contact
                  </Button>
                  <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                    No thanks
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
        <>
        <DialogHeader className="shrink-0">
          <DialogTitle>Invite Collaborator{eventName ? ` — ${eventName}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0">
          <div ref={emailContainerRef} className="relative">
            <Label>Email Address</Label>
            <div className="relative mt-1">
              <Input
                type="email"
                placeholder="collaborator@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setShowContactSuggestions(true); }}
                onFocus={() => setShowContactSuggestions(true)}
              />
              {contactSuggestions.length > 0 && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent transition-colors"
                  onClick={() => setShowContactSuggestions(!showContactSuggestions)}
                  title="Select from contacts"
                >
                  <Users className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
            {showContactSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-lg max-h-48 overflow-y-auto">
                {filteredSuggestions.map((c, i) => (
                  <button
                    key={`${c.email}-${i}`}
                    onClick={() => { setEmail(c.email); setShowContactSuggestions(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground ml-2">{c.email}</span>
                    <span className="text-muted-foreground text-xs ml-1">({c.contactName})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label>Role</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {roles.map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    role === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          {role === "Custom" && (
            <div>
              <Label>Custom Role Name</Label>
              <Input
                placeholder="e.g. Stage Manager, Sound Engineer..."
                value={customRoleName}
                onChange={(e) => setCustomRoleName(e.target.value)}
                className="mt-1"
              />
            </div>
          )}
          <div>
            <Label>Permissions</Label>
            <Select value={permission} onValueChange={(v) => setPermission(v as Permission)} disabled={restrictToViewOnly}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(permissionLabels) as Permission[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    <div className="flex flex-col">
                      <span>{permissionLabels[p]}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {restrictToViewOnly
                ? "Performers can only invite collaborators with view-only access."
                : permissionDescriptions[permission]}
            </p>
          </div>
          <div>
            <Label>Message (optional)</Label>
            <Textarea placeholder="Add a personal message..." value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1" rows={3} />
          </div>

          {/* Generated invitation code */}
          {invitationCode && (
            <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Invitation created</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Code:</span>
                <span className="font-mono text-sm font-semibold">{invitationCode}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyCode}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              {generatedLink && (
                <p className="text-xs text-muted-foreground break-all font-mono">{generatedLink}</p>
              )}
            </div>
          )}

          {/* Link without code (fallback) */}
          {generatedLink && !invitationCode && (
            <div className="p-2 rounded-md bg-muted text-xs break-all font-mono">
              {generatedLink}
            </div>
          )}
        </div>
        <DialogFooter className="flex-col sm:flex-row sm:flex-wrap gap-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleCopyLink}
            disabled={!isValid || generating || sending}
            variant="secondary"
            className="gap-2"
          >
            {generating ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
            ) : (
              <><Copy className="h-4 w-4" /> Copy Link</>
            )}
          </Button>
          <Button
            onClick={handleSendEmail}
            disabled={!isValid || generating || sending}
            className="gap-2"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Send Email
              </>
            )}
          </Button>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
