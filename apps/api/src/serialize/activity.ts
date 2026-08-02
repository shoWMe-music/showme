type ActivityRow = {
  id: string;
  type: string;
  eventId: string | null;
  actorDisplay: string | null;
  targetKind: string | null;
  targetId: string | null;
  summary: unknown;
  createdAt: Date;
};

export interface SerializedActivity {
  id: string;
  type: string;
  eventId: string | null;
  actorDisplay: string | null;
  targetKind: string | null;
  targetId: string | null;
  summary: unknown;
  createdAt: string;
}

/** Shape an activity row for the wire. The row is already access-filtered by the route. */
export function serializeActivity(row: ActivityRow): SerializedActivity {
  return {
    id: row.id,
    type: row.type,
    eventId: row.eventId,
    actorDisplay: row.actorDisplay,
    targetKind: row.targetKind,
    targetId: row.targetId,
    summary: row.summary ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
