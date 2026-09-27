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

  /** Write a set of rows, and say so. */
  const applyDrafts = useCallback(
    async (drafts: Awaited<ReturnType<typeof startingPointDrafts>>, what: string) => {
      if (drafts.length === 0) return;
      setApplying(true);
      try {
        await editor.addMany(drafts);
        toast.success(`Added ${drafts.length} items from ${what}.`);
      } finally {
        setApplying(false);
        setPickerOpen(false);
      }
    },
    [editor, toast],
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
    if (editor.items.length === 0) return "Add some items first — there is nothing to save yet.";
    if (editor.items.every((item) => !item.localDateTime)) {
      return "Give at least one item a time — a template without times has nothing to apply.";
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
    saveBlockedReason,
  };
}
