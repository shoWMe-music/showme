import { customFetch } from "@showme/api-client";
import type { AvatarTone } from "@showme/design-system";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { ThreadComment } from "./CommentThread";

/**
 * The Messages tab's data layer, kept out of the component so the component stays
 * short and dumb.
 *
 * These two endpoints are called through `customFetch` rather than a generated
 * orval hook on purpose, and it is a temporary state: orval regenerates with
 * `clean: true`, wiping and rewriting every generated file from a live API's
 * OpenAPI, and this tree currently has several people adding routes at once — a
 * regeneration here would bake in whatever else happened to be running. The
 * mutator is the same one every generated hook uses, so base URL, bearer token,
 * `x-profile-id` and the typed error envelope all behave identically. Swap these
 * for `useGetApiV1EventsIdMessageThreads` after the next regeneration.
 */

export interface MessageThreadReader {
  participantId: string;
  name: string;
  role: string;
}

export interface MessageThread {
  key: string;
  scope: "all" | "operators" | "party";
  participantId: string | null;
  title: string;
  readers: MessageThreadReader[];
  messageCount: number;
  lastMessageAt: string | null;
  canPost: boolean;
}

export interface ThreadMessage {
  id: string;
  eventId: string;
  senderUserId: string;
  senderParticipantId: string | null;
  threadKey: string;
  threadParticipantId: string | null;
  body: string;
  createdAt: string;
}

/** A participant, by id, so a message's sender can be named. */
export interface MessagesTabParty {
  id: string;
  name: string;
}

const threadsKey = (eventId: string) => ["event-message-threads", eventId];
const messagesKey = (eventId: string, threadKey: string) => ["event-messages", eventId, threadKey];

export function useEventMessageThreads(eventId: string, roster: MessagesTabParty[]) {
  const queryClient = useQueryClient();
  // Whose messages are "mine". `senderUserId` and the session's `userId` are the
  // same `users.id` — the API stamps every message with `principal.userId` and
  // `POST /auth/session` returns that same row's id — so this is an identity
  // check against the server's own key, never a match on a display name.
  const { session } = useAuth();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const threads = useQuery({
    queryKey: threadsKey(eventId),
    queryFn: ({ signal }) =>
      customFetch<{ items: MessageThread[] }>({
        url: `/api/v1/events/${eventId}/message-threads`,
        method: "GET",
        signal,
      }).then((response) => response.items),
  });

  // Default to the event room until the reader picks a thread. Derived rather than
  // stored, so it survives the threads list arriving after the first render.
  const selected =
    threads.data?.find((thread) => thread.key === selectedKey) ?? threads.data?.[0] ?? null;

  const messages = useQuery({
    queryKey: messagesKey(eventId, selected?.key ?? ""),
    enabled: selected != null,
    queryFn: ({ signal }) =>
      customFetch<ThreadMessage[]>({
        url: `/api/v1/events/${eventId}/messages`,
        method: "GET",
        params: { threadKey: selected?.key },
        signal,
      }),
  });

  const post = useMutation({
    mutationFn: (body: string) =>
      customFetch<ThreadMessage>({
        url: `/api/v1/events/${eventId}/messages`,
        method: "POST",
        data: {
          body,
          visibility: selected?.scope ?? "all",
          // Only a party thread names a participant; the room and the back office
          // are keyed by scope alone (see the message schema).
          ...(selected?.scope === "party" ? { threadParticipantId: selected.participantId } : {}),
        },
      }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: messagesKey(eventId, selected?.key ?? "") });
      queryClient.invalidateQueries({ queryKey: threadsKey(eventId) });
    },
  });

  const comments = useMemo(
    () => toComments(messages.data ?? [], roster, session?.userId ?? null),
    [messages.data, roster, session?.userId],
  );

  return {
    threads,
    messages,
    comments,
    selected,
    selectKey: setSelectedKey,
    draft,
    setDraft,
    post,
  };
}

/** The four non-brand avatar tones, so two different people are two colours. */
const SENDER_TONES: AvatarTone[] = ["amber", "green", "purple", "blue"];

/**
 * A tone that is stable for one person and spread across the roster — the same
 * face is the same colour every time you open the thread, which is most of what
 * an avatar is for when nobody has uploaded a picture.
 */
function senderTone(seed: string): AvatarTone {
  let total = 0;
  for (let index = 0; index < seed.length; index += 1) total += seed.charCodeAt(index);
  return SENDER_TONES[total % SENDER_TONES.length] ?? "amber";
}

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function clockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : CLOCK_FORMAT.format(date);
}

function toComments(
  messages: ThreadMessage[],
  roster: MessagesTabParty[],
  currentUserId: string | null,
): ThreadComment[] {
  return messages.map((message) => {
    const author =
      roster.find((party) => party.id === message.senderParticipantId)?.name ?? "Member";
    return {
      id: message.id,
      author,
      initials: initials(author),
      tone: senderTone(message.senderParticipantId ?? message.senderUserId),
      createdAt: message.createdAt,
      time: clockTime(message.createdAt),
      body: message.body,
      isOwn: currentUserId != null && message.senderUserId === currentUserId,
    };
  });
}

function initials(label: string): string {
  return (
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
