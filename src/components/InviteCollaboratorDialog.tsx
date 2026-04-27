import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { httpsCallable } from "firebase/functions";
import { setDoc, doc, serverTimestamp } from "firebase/firestore";
import { getFirestoreDb } from "@/integrations/firebase/app";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Copy, Users, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast, copyToast } from "@/hooks/use-toast";
import { insertCollaboratorInvite, addEventCollaborator } from "@/lib/db";
import { legacyRoleToEventRole, type EventCollaboratorRole, type ContactPerson } from "@/lib/models";
import { useContacts } from "@/lib/queries";
import { useMyInvitationCodes } from "@/lib/queries/useInvitationCodes";
import { useAuth } from "@/lib/auth-context";
import { queryKeys } from "@/lib/queries/keys";
import { PROFILE_ROOT_SCHEMA_VERSION } from "@/lib/profiles";

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
}

export default function InviteCollaboratorDialog({ open, onOpenChange, eventName, eventId, defaultEmail, defaultRole, defaultName, onCollaboratorAdded }: InviteCollaboratorDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(defaultRole || "Performer");
  const [permission, setPermission] = useState<Permission>("editor");
  const [customRoleName, setCustomRoleName] = useState("");
  const [message, setMessage] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [showContactSuggestions, setShowContactSuggestions] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const emailContainerRef = useRef<HTMLDivElement>(null);

  const { user } = useAuth();
  const contacts = useContacts();
  const queryClient = useQueryClient();
  const { data: myInvitationCodes } = useMyInvitationCodes();

  const inviteMutation = useMutation({
    mutationFn: (data: Parameters<typeof insertCollaboratorInvite>[0]) => insertCollaboratorInvite(data),
    onError: () => {
      toast({ title: "Error", description: "Failed to create invite.", variant: "destructive" });
    },
  });

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

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail || "");
      setRole(defaultRole || "Performer");
      setPermission("editor");
      setCustomRoleName("");
      setMessage("");
      setShowContactSuggestions(false);
      setGenerating(false);
      setSending(false);

      // Check for an existing active invitation code for this event + name
      const existing = myInvitationCodes?.find(
        (ic) =>
          ic.status === "active" &&
          ic.linkedEventId === eventId &&
          defaultName &&
          ic.recipientName === defaultName,
      );
      if (existing) {
        setInvitationCode(existing.code);
        setGeneratedLink(`${window.location.origin}/signup?code=${existing.code}`);
        if (existing.recipientEmail) setEmail(existing.recipientEmail);
      } else {
        setGeneratedLink("");
        setInvitationCode("");
      }
    }
  }, [open, eventId, defaultName, defaultEmail, defaultRole, myInvitationCodes]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emailContainerRef.current && !emailContainerRef.current.contains(e.target as Node)) {
        setShowContactSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const generateInvite = async () => {
    if (!eventId || !user) return null;
    const token = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const roleLabel = role === "Custom" ? customRoleName || "Custom" : role;
    const eventRole = inviteToEventRole(roleLabel, permission);

    try {
      await inviteMutation.mutateAsync({
        token,
        event_id: eventId,
        email: email.trim(),
        role: roleLabel,
        eventRole,
        permission,
        message: message.trim(),
      });
    } catch {
      return null;
    }

    // Create stub profile for the invitee
    const displayName = defaultName || email.trim().split("@")[0];
    const stubProfileId = `stub-${eventId}-${token}`;
    try {
      await setDoc(doc(getFirestoreDb(), "profiles", stubProfileId), {
        name: displayName,
        owner_uid: user.uid,
        slot: roleLabel.toLowerCase(),
        role: roleLabel.toLowerCase(),
        unclaimed: true,
        schemaVersion: PROFILE_ROOT_SCHEMA_VERSION,
        linkedEventId: eventId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to create stub profile:", err);
      // Non-critical — continue
    }

    // Generate invitation code via Cloud Function
    const createInvitationCode = httpsCallable<
      {
        recipientEmail?: string;
        recipientName?: string;
        recipientRole?: string;
        linkedProfileId?: string;
        linkedEventId?: string;
        source: string;
        sourceCollaboratorInviteToken?: string;
      },
      { code: string }
    >(getFirebaseFunctions(), "createInvitationCode");

    let code: string;
    try {
      const result = await createInvitationCode({
        source: "collaborator_invite",
        recipientEmail: email.trim(),
        recipientName: displayName,
        recipientRole: roleLabel.toLowerCase(),
        linkedProfileId: stubProfileId,
        linkedEventId: eventId,
        sourceCollaboratorInviteToken: token,
      });
      code = result.data.code;
      setInvitationCode(code);

      // Invalidate invitation codes cache
      if (user.uid) {
        queryClient.invalidateQueries({ queryKey: queryKeys.myInvitationCodes(user.uid) });
      }
    } catch (err) {
      console.error("Failed to create invitation code:", err);
      toast({ title: "Error", description: "Failed to generate invitation code.", variant: "destructive" });
      return null;
    }

    // Add collaborator to event's collaborators subcollection with pending status
    try {
      await addEventCollaborator(eventId, {
        id: token,
        email: email.trim(),
        name: displayName,
        eventRole,
        role: roleLabel,
        status: "pending",
        invitedAt: new Date().toISOString(),
        profileId: stubProfileId,
      });
      // Refresh the collaborators list in the parent
      if (onCollaboratorAdded) onCollaboratorAdded();
    } catch (err) {
      console.error("Failed to add event collaborator:", err);
    }

    const url = `${window.location.origin}/signup?code=${code}`;
    setGeneratedLink(url);
    return { url, code };
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

      // Call sendInvitationEmail Cloud Function
      try {
        const sendInvitationEmail = httpsCallable<
          {
            code: string;
            recipientEmail: string;
            recipientName: string;
            eventName?: string;
            senderName: string;
            message?: string;
          },
          { ok: true }
        >(getFirebaseFunctions(), "sendInvitationEmail");

        await sendInvitationEmail({
          code: result.code || "",
          recipientEmail: email.trim(),
          recipientName: defaultName || email.trim().split("@")[0],
          eventName: eventName || undefined,
          senderName: user?.displayName || user?.email || "A shoWMe user",
          message: message.trim() || undefined,
        });
      } catch (err) {
        console.error("Failed to send invitation email:", err);
        // Non-critical — toast will still show success for the invitation itself
      }

      const roleLabel = role === "Custom" ? customRoleName || "Custom" : role;
      toast({
        title: "Invitation sent",
        description: `Invited ${email} as ${roleLabel} (${permissionLabels[permission]})${eventName ? ` for ${eventName}` : ""}`,
      });
      onOpenChange(false);
    } finally {
      setSending(false);
    }
  };

  const isValid = email.trim() && (role !== "Custom" || customRoleName.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
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
            <Select value={permission} onValueChange={(v) => setPermission(v as Permission)}>
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
            <p className="text-xs text-muted-foreground mt-1">{permissionDescriptions[permission]}</p>
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
        <DialogFooter className="flex-col sm:flex-row gap-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleCopyLink}
            disabled={!isValid || generating || sending || inviteMutation.isPending}
            variant="secondary"
            className="gap-2"
          >
            {generating ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
            ) : (
              <><Copy className="h-4 w-4" /> Copy Invite Link</>
            )}
          </Button>
          <Button
            onClick={handleSendEmail}
            disabled={!isValid || generating || sending || inviteMutation.isPending}
            className="gap-2"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Send via Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
