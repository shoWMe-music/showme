import {
  getGetApiV1ProfilesIdTemplatesQueryKey,
  useGetApiV1ProfilesIdTemplates,
  usePostApiV1ProfilesIdTemplates,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import {
  type ScheduleAnchor,
  draftsFromScheduleTemplate,
  readScheduleTemplatePayload,
  scheduleTemplateFromItems,
  startingPointDrafts,
} from "../lib/scheduleTemplate";
import type { EventScheduleEditor } from "./useEventScheduleEditor";

/**
 * TEMPLATES FOR THE RUN OF SHOW (ClickUp `123qy9rpvfq`).
 *
 * Ran: *"Templates saving are missing from all sections of the event details tab"*,
 * *"Schedule 'Load default template' button missing"* with the ten rows he listed, and
 * *"We should have Templates anywhere possible, and offer 'Starting point' templates
 * where possible."*
 *
 * Nothing new was needed server-side. `templates` has carried eight categories and a
 * per-category payload validator since PLAN.md §K; the app had written exactly one of
 * them (`budget`, from `useBudgetToolbar`). This is the second caller, so it follows
 * that one deliberately — the same `GET`/`POST /profiles/:id/templates`, the same
 * entitlement gate, the same "filter by category client-side" read.
 *
 * The arithmetic is in `lib/scheduleTemplate.ts`, tested there. This is the plumbing.
 */

/** One saved run of show, as the picker lists it. */
export interface SavedScheduleTemplate {
  id: string;
  name: string;
  /** How many rows it will add — worth knowing before pressing it. */
  itemCount: number;
  apply: () => void;
}

export interface ScheduleTemplates {
  /** Ran's ten-row starting point. Null when this event has no date to hang it on. */
  loadStartingPoint: (() => void) | null;
  templates: SavedScheduleTemplate[];
  /** True while a picker or the naming field should be on screen. */
  isPickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  isNaming: boolean;
  startNaming: () => void;
  cancelNaming: () => void;
  saveAs: (name: string) => void;
  /** True while rows are being written, so the card can say so. */
  isApplying: boolean;
  /**
   * The choice a non-empty schedule raises before anything is written — null when
   * nothing is waiting on an answer. `count` is how many rows would arrive and
   * `existingCount` how many are already there, so the question can state both.
   */
  pendingApply: {
    what: string;
    count: number;
    existingCount: number;
    add: () => void;
    replace: () => void;
    cancel: () => void;
  } | null;
  /** Why saving is not offered right now, or null. */
  saveBlockedReason: string | null;
}

export function useScheduleTemplates(
  editor: EventScheduleEditor,
  anchor: ScheduleAnchor,
): ScheduleTemplates {
  const toast = useToast();
  const queryClient = useQueryClient();
  const profileId = getActiveProfileId();
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [isNaming, setNaming] = useState(false);
  const [isApplying, setApplying] = useState(false);

  const templatesQuery = useGetApiV1ProfilesIdTemplates(profileId ?? "", {
    query: { enabled: Boolean(profileId) },
  });

  const createTemplate = usePostApiV1ProfilesIdTemplates({
    mutation: {
      onSuccess: () => {
        toast.success("Run of show saved as a template.");
        if (profileId) {
          queryClient.invalidateQueries({
            queryKey: getGetApiV1ProfilesIdTemplatesQueryKey(profileId),
          });
        }
      },
      // The API's own words: the entitlement refusal names the plan limit ("2 templates
      // on Basic"), which is the only thing that tells the operator what to do next.
      onError: (error: unknown) => toast.error(errorMessage(error, "Couldn't save the template.")),
    },
  });

  /**
   * A SCHEDULE THAT ALREADY HAS ROWS IS ASKED, NOT APPENDED TO (QA sweep run 5, QA5-12).
   *
   * `applyDrafts` appended unconditionally, so pressing **Load starting point** on a
   * schedule that already held the ten-row starting point produced **twenty** rows,
   * every label duplicated, with no warning and no way to say "replace these". The
   * toast was honest — *"Added 10 items from the starting point."* — and taking the ten
   * back was ten clicks.
   *
   * So: an empty schedule applies straight away (there is nothing to ask about), and a
   * schedule with rows raises the pending choice below. Add is still there, because
   * building a bill out of two templates is a real thing; Replace is the answer that did
   * not exist.
   */
  const [pending, setPending] = useState<{
    drafts: Awaited<ReturnType<typeof startingPointDrafts>>;
    what: string;
  } | null>(null);

  /** Write a set of rows, and say so. `replace` clears what is there first. */
  const writeDrafts = useCallback(
    async (
      drafts: Awaited<ReturnType<typeof startingPointDrafts>>,
      what: string,
      mode: "add" | "replace",
    ) => {
      if (drafts.length === 0) return;
      setApplying(true);
      try {
        if (mode === "replace") {
          // Cleared FIRST and awaited, so a failure half-way leaves fewer rows rather
          // than a doubled schedule — the state this exists to prevent.
          const existing = editor.items.map((item) => item.id);
          await editor.removeMany(existing);
        }
        await editor.addMany(drafts);
        toast.success(
          mode === "replace"
            ? `Replaced the schedule with ${drafts.length} items from ${what}.`
            : `Added ${drafts.length} items from ${what}.`,
        );
      } finally {
        setApplying(false);
        setPickerOpen(false);
        setPending(null);
      }
    },
    [editor, toast],
  );

  const applyDrafts = useCallback(
    async (drafts: Awaited<ReturnType<typeof startingPointDrafts>>, what: string) => {
      if (drafts.length === 0) return;
      if (editor.items.length === 0) {
        await writeDrafts(drafts, what, "add");
        return;
      }
      setPending({ drafts, what });
    },
    [editor.items.length, writeDrafts],
  );

  const loadStartingPoint = useMemo(() => {
    const drafts = startingPointDrafts(anchor);
    // No date, no starting point — and the button is absent rather than disabled,
    // because "give the event a date first" is the date field's business, not a
    // tooltip on a template button.
    if (drafts.length === 0) return null;
    return () => void applyDrafts(drafts, "the starting point");
  }, [anchor, applyDrafts]);

  const templates = useMemo<SavedScheduleTemplate[]>(
    () =>
      (templatesQuery.data ?? [])
        .filter((template) => template.category === "schedule")
        .map((template) => {
          const payload = readScheduleTemplatePayload(template.payload);
          const drafts = draftsFromScheduleTemplate(payload, anchor.eventDate);
          return {
            id: template.id,
            name: template.name,
            itemCount: drafts.length,
            apply: () => void applyDrafts(drafts, `“${template.name}”`),
          };
        }),
    [templatesQuery.data, anchor.eventDate, applyDrafts],
  );

  const saveAs = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!profileId || trimmed === "") return;
      createTemplate.mutate({
        id: profileId,
        data: {
          category: "schedule",
          name: trimmed,
          payload: scheduleTemplateFromItems(editor.items, anchor.eventDate),
        },
      });
      setNaming(false);
    },
    [profileId, createTemplate, editor.items, anchor.eventDate],
  );

  /**
   * Why there is nothing to save, in the operator's terms.
   *
   * A template of an empty schedule is a named nothing that would load as nothing, and
   * the same is true of a schedule whose rows all lack times — `scheduleTemplateFromItems`
   * drops those, so the stored payload would be empty while the screen looked full.
   */
  const saveBlockedReason = useMemo(() => {
    if (!profileId) return "Pick a profile to save templates under.";
    if (editor.items.length === 0) return "Add some items first. There is nothing to save yet.";
    if (editor.items.every((item) => !item.localDateTime)) {
      return "Give at least one item a time. A template without times has nothing to apply.";
    }
    return null;
  }, [profileId, editor.items]);

  return {
    loadStartingPoint,
    templates,
    isPickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    isNaming,
    startNaming: () => setNaming(true),
    cancelNaming: () => setNaming(false),
    saveAs,
    isApplying,
    pendingApply: pending
      ? {
          what: pending.what,
          count: pending.drafts.length,
          existingCount: editor.items.length,
          add: () => void writeDrafts(pending.drafts, pending.what, "add"),
          replace: () => void writeDrafts(pending.drafts, pending.what, "replace"),
          cancel: () => setPending(null),
        }
      : null,
    saveBlockedReason,
  };
}
