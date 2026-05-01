import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { useUser } from "@/lib/user-context";
import { insertMessage, subscribeEventMessages } from "@/lib/db";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Send, Paperclip, Smile, Download, FileIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import DocumentPreviewDialog from "@/components/DocumentPreviewDialog";

interface Attachment {
  name: string;
  size: number;
  type: string;
  url: string;
}

interface Message {
  id: string;
  event_id: string;
  sender_name: string;
  sender_uid?: string;
  sender_profile_id?: string;
  sender_avatar_url?: string;
  content: string;
  attachments: Attachment[];
  created_at: string;
}

interface MessageGroup {
  senderUid: string | undefined;
  senderName: string;
  senderAvatarUrl: string | undefined;
  isMe: boolean;
  messages: Message[];
}

const MUSIC_EMOJIS = [
  "\u{1F3B5}", "\u{1F3B6}", "\u{1F3B8}", "\u{1F941}", "\u{1F3B9}", "\u{1F3B7}",
  "\u{1F3BA}", "\u{1F3BB}", "\u{1F3A4}", "\u{1F3A7}", "\u{1F3BC}", "\u{1FA97}",
  "\u{1FA98}", "\u{1FA95}",
];

export default function EventMessages({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const { currentUser, profiles } = useUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ name: string; url: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resolve the acting profile for the current user (first created profile)
  const actingProfile = useMemo(() => {
    for (const [, p] of Object.entries(profiles)) {
      if (p.created && p.id && p.name) return p;
    }
    return undefined;
  }, [profiles]);

  // Display name for the current sender. Format: "John Doe (Profile Name)" so
  // recipients see both who is talking and which profile they represent. Falls
  // back through email-local → email when the user hasn't filled out their
  // name (common for users who joined via a profile invite). sender_name is
  // *persisted* into the message doc, so we never want to write "Anonymous".
  const emailLocal = currentUser.email?.split("@")[0]?.trim();
  const userPart =
    currentUser.name?.trim() || emailLocal || currentUser.email || "Unknown user";
  const senderName = actingProfile?.name
    ? `${userPart} (${actingProfile.name})`
    : userPart;

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setMessages([]);
      return;
    }
    const unsub = subscribeEventMessages(eventId, (rows) => {
      setMessages(
        rows.map((r) => ({
          id: r.id as string,
          event_id: r.event_id as string,
          sender_name: r.sender_name as string,
          sender_uid: r.sender_uid as string | undefined,
          sender_profile_id: r.sender_profile_id as string | undefined,
          sender_avatar_url: r.sender_avatar_url as string | undefined,
          content: r.content as string,
          attachments: (r.attachments as Attachment[]) || [],
          created_at: r.created_at as string,
        })),
      );
    });
    return () => unsub();
  }, [user?.uid, eventId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Group consecutive messages from the same sender
  const messageGroups = useMemo<MessageGroup[]>(() => {
    const groups: MessageGroup[] = [];
    for (const msg of messages) {
      const isMe =
        (msg.sender_uid && user?.uid && msg.sender_uid === user.uid) ||
        (!msg.sender_uid && msg.sender_name === senderName);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.senderUid === msg.sender_uid && lastGroup.isMe === !!isMe) {
        lastGroup.messages.push(msg);
        // Update avatar if a newer message has it
        if (msg.sender_avatar_url) lastGroup.senderAvatarUrl = msg.sender_avatar_url;
      } else {
        groups.push({
          senderUid: msg.sender_uid,
          senderName: msg.sender_name,
          senderAvatarUrl: msg.sender_avatar_url,
          isMe: !!isMe,
          messages: [msg],
        });
      }
    }
    return groups;
  }, [messages, user?.uid, senderName]);

  const sendMessage = async (content: string, attachments: Attachment[] = []) => {
    if (!user?.uid) return;
    if (!content.trim() && attachments.length === 0) return;
    await insertMessage(eventId, {
      sender_name: senderName,
      sender_profile_id: actingProfile?.id || null,
      sender_avatar_url: actingProfile?.avatarUrl || currentUser.avatarUrl || null,
      content: content.trim(),
      attachments: attachments as unknown[],
    });
    setText("");
  };

  const handleSend = async () => {
    if (pendingFile && user?.uid) {
      setUploading(true);
      try {
        const safe = pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `message-attachments/${eventId}/${Date.now()}-${safe}`;
        const url = await uploadUserBinary(path, pendingFile, pendingFile.type || "application/octet-stream");
        const attachment: Attachment = {
          name: pendingFile.name,
          size: pendingFile.size,
          type: pendingFile.type,
          url,
        };
        await sendMessage(text, [attachment]);
        cancelPendingFile();
      } catch {
        console.error("Upload failed");
      } finally {
        setUploading(false);
      }
      return;
    }
    void sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setText(prev => prev + emojiData.emoji);
    setEmojiOpen(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;
    setPendingFile(file);
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      setPendingPreviewUrl(URL.createObjectURL(file));
    } else {
      setPendingPreviewUrl(null);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const cancelPendingFile = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!user?.uid) {
    return (
      <div className="flex flex-col h-[600px] border rounded-lg bg-card items-center justify-center p-6 text-center text-muted-foreground text-sm">
        Sign in to load and send messages for this event.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[600px] border rounded-lg bg-card">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No messages yet. Start the conversation!</p>
          )}
          {messageGroups.map((group, gi) => (
            <div key={gi} className={cn("flex gap-2", group.isMe ? "justify-end" : "justify-start")}>
              {/* Avatar for other senders */}
              {!group.isMe && (
                <div className="shrink-0 mt-1">
                  {group.senderAvatarUrl ? (
                    <img src={group.senderAvatarUrl} alt={group.senderName} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {group.senderName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
              )}

              <div className={cn("flex flex-col max-w-[70%]", group.isMe ? "items-end" : "items-start")}>
                {/* Sender name at top of group */}
                {!group.isMe && (
                  <p className="text-xs font-medium text-muted-foreground mb-1 px-1">{group.senderName}</p>
                )}

                {/* Messages in group */}
                <div className={cn("flex flex-col gap-0.5", group.isMe ? "items-end" : "items-start")}>
                  {group.messages.map((msg, mi) => {
                    const attachments = msg.attachments || [];
                    const isFirst = mi === 0;
                    const isLast = mi === group.messages.length - 1;
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "px-3 py-1.5 text-sm",
                          group.isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                          // Rounded corners: full on outer edges, tight on inner edges between grouped messages
                          group.isMe
                            ? cn(
                                "rounded-l-lg",
                                isFirst && "rounded-tr-lg",
                                isLast && "rounded-br-lg",
                                !isFirst && "rounded-tr-sm",
                                !isLast && "rounded-br-sm",
                              )
                            : cn(
                                "rounded-r-lg",
                                isFirst && "rounded-tl-lg",
                                isLast && "rounded-bl-lg",
                                !isFirst && "rounded-tl-sm",
                                !isLast && "rounded-bl-sm",
                              ),
                        )}
                      >
                        {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                        {attachments.map((att, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setPreviewDoc({ name: att.name, url: att.url })}
                            className={cn(
                              "flex items-center gap-2 mt-1 p-2 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity text-left",
                              group.isMe ? "bg-primary-foreground/10" : "bg-background"
                            )}
                          >
                            {att.type?.startsWith("image/") ? (
                              <img src={att.url} alt={att.name} className="max-w-[200px] max-h-[150px] rounded" />
                            ) : (
                              <>
                                <FileIcon className="h-4 w-4 shrink-0" />
                                <span className="truncate">{att.name}</span>
                                <span className="text-[10px] opacity-60">{formatSize(att.size)}</span>
                                <Download className="h-3 w-3 shrink-0" />
                              </>
                            )}
                          </button>
                        ))}
                        {isLast && (
                          <p className={cn("text-[10px] mt-0.5", group.isMe ? "text-primary-foreground/60" : "text-muted-foreground")}>
                            {format(new Date(msg.created_at), "HH:mm")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Avatar for own messages */}
              {group.isMe && (
                <div className="shrink-0 mt-1">
                  {(currentUser.avatarUrl || actingProfile?.avatarUrl) ? (
                    <img src={currentUser.avatarUrl || actingProfile?.avatarUrl} alt={senderName} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
                      {currentUser.initials}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Media preview */}
      {pendingFile && (
        <div className="border-t bg-muted/30 px-3 py-2">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {pendingPreviewUrl && pendingFile.type.startsWith("image/") && (
                <div className="relative">
                  <Skeleton className="absolute inset-0 max-h-[200px] rounded-lg" />
                  <img src={pendingPreviewUrl} alt={pendingFile.name} className="relative max-h-[200px] rounded-lg object-contain" onLoad={(e) => { const prev = e.currentTarget.previousElementSibling as HTMLElement; if (prev) prev.style.display = "none"; }} />
                </div>
              )}
              {pendingPreviewUrl && pendingFile.type.startsWith("video/") && (
                <video src={pendingPreviewUrl} controls className="max-h-[200px] rounded-lg" />
              )}
              {!pendingPreviewUrl && (
                <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <FileIcon className="h-8 w-8 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{pendingFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(pendingFile.size)}</p>
                  </div>
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={cancelPendingFile}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="border-t p-3 flex items-center gap-2">
        <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0" type="button">
              <Smile className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" side="top" align="start">
            <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b">
              {MUSIC_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-base"
                  onClick={() => handleEmojiClick({ emoji } as EmojiClickData)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <EmojiPicker onEmojiClick={handleEmojiClick} width={300} height={400} />
          </PopoverContent>
        </Popover>

        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1"
        />

        <Button size="icon" type="button" onClick={() => void handleSend()} disabled={(!text.trim() && !pendingFile) || uploading}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <DocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        fileName={previewDoc?.name}
        fileUrl={previewDoc?.url}
      />
    </div>
  );
}
