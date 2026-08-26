import { customFetch } from "@showme/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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

const threadsKey = (eventId: string) => ["event-message-threads", eventId];
const messagesKey = (eventId: string, threadKey: string) => ["event-messages", eventId, threadKey];

export function useEventMessageThreads(eventId: string) {
  const queryClient = useQueryClient();
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

  return {
    threads,
    messages,
    selected,
    selectKey: setSelectedKey,
    draft,
    setDraft,
    post,
  };
}
