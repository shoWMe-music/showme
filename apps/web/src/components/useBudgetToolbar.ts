import {
  getGetApiV1ProfilesIdTemplatesQueryKey,
  useGetApiV1ProfilesIdTemplates,
  usePostApiV1ProfilesIdTemplates,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { budgetToCsv, computeBudgetProjection, readBudgetTemplatePayload } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { budgetFileName, downloadTextFile, printBudget } from "../lib/budgetExport";
import { errorMessage } from "../lib/errors";
import { toMinorUnits } from "../lib/moneyUnits";
import type { BudgetToolbarAction } from "./BudgetPlanner";
import { draftsFromTemplate, templateFrom } from "./budgetTemplateDrafts";
import { type BudgetEditor, budgetInputsFrom } from "./useBudgetEditor";

/**
 * The Budget Planner's toolbar — Load Template, Save as Template, CSV, PDF.
 *
 * ON THE FIFTH BUTTON: the design prototype also shows "Share". It is NOT built
 * here, and deliberately so rather than as an oversight. The share subsystem
 * (`apps/api/src/routes/shares.ts`) issues a token that `GET /shares/:token`
 * resolves to a capability grant and nothing more — there is no route that turns
 * a share token into budget data and no page that renders one, so the button
 * could only ever produce a link that opens nothing. Building a second sharing
 * mechanism beside that one to make the button light up is the failure the event
 * header already avoids: it carries a working Share & Export. A dead control on
 * the toolbar would be worse than an absent one.
 *
 * Save/Load ride on the `templates` table, whose `category` enum has carried
 * `'budget'` since the first migration (PLAN.md §K) — no new table was needed.
 */

/** A saved budget template as the picker lists it. */
export interface SavedBudgetTemplate {
  id: string;
  name: string;
  /** Applied to the planner when the operator picks this row. */
  apply: () => void;
}

export interface BudgetToolbar {
  actions: BudgetToolbarAction[];
  /** True while the template picker is open. */
  isPickerOpen: boolean;
  closePicker: () => void;
  templates: SavedBudgetTemplate[];
  isLoadingTemplates: boolean;
  /** True while the naming dialog for "Save as Template" is open. */
  isNaming: boolean;
  closeNaming: () => void;
  saveAs: (name: string) => void;
  isSaving: boolean;
}

export function useBudgetToolbar(
  editor: BudgetEditor,
  eventTitle: string,
  currency: string,
): BudgetToolbar {
  const toast = useToast();
  const queryClient = useQueryClient();
  const profileId = getActiveProfileId();
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [isNaming, setNaming] = useState(false);

  const templatesQuery = useGetApiV1ProfilesIdTemplates(profileId ?? "", {
    query: { enabled: Boolean(profileId) },
  });
  const createTemplate = usePostApiV1ProfilesIdTemplates({
    mutation: {
      onSuccess: () => {
        toast.success("Budget saved as a template.");
        if (profileId) {
          queryClient.invalidateQueries({
            queryKey: getGetApiV1ProfilesIdTemplatesQueryKey(profileId),
          });
        }
      },
      onError: (error: unknown) => toast.error(errorMessage(error, "Couldn't save the template.")),
    },
  });

  const templates = useMemo<SavedBudgetTemplate[]>(
    () =>
      (templatesQuery.data ?? [])
        .filter((template) => template.category === "budget")
        .map((template) => ({
          id: template.id,
          name: template.name,
          apply: () => {
            const payload = readBudgetTemplatePayload(template.payload);
            editor.applyTemplate(draftsFromTemplate(payload, editor));
            setPickerOpen(false);
            toast.success(`Loaded “${template.name}”.`);
          },
        })),
    [templatesQuery.data, editor, toast],
  );

  const saveAs = useCallback(
    (name: string) => {
      if (!profileId || name.trim() === "") return;
      createTemplate.mutate({
        id: profileId,
        data: { category: "budget", name: name.trim(), payload: templateFrom(editor) },
      });
      setNaming(false);
    },
    [profileId, createTemplate, editor],
  );

  const exportCsv = useCallback(() => {
    const inputs = budgetInputsFrom(editor);
    const csv = budgetToCsv({
      eventTitle,
      currency,
      ticketTiers: editor.ticketTiers.map((tier) => ({
        name: tier.name,
        unitAmount: BigInt(toMinorUnits(tier.price)),
        quantity: Math.trunc(Number(tier.quantity)) || 0,
      })),
      averageBarSpend: inputs.averageBarSpend,
      capacity: inputs.capacity,
      otherRevenue: inputs.otherRevenue,
      customRevenue: editor.customRevenue.map((row) => ({
        label: row.label,
        amount: BigInt(toMinorUnits(row.value)),
      })),
      costs: editor.costs.map((cost) => ({
        label: cost.label,
        amount: BigInt(toMinorUnits(cost.value)),
      })),
      projection: computeBudgetProjection(inputs),
    });
    downloadTextFile(budgetFileName(eventTitle, "csv"), csv, "text/csv;charset=utf-8");
  }, [editor, eventTitle, currency]);

  const actions = useMemo<BudgetToolbarAction[]>(
    () => [
      {
        label: "Load Template",
        icon: "file",
        onClick: () => setPickerOpen(true),
        // Nothing to pick from, and an empty picker teaches the operator
        // nothing they cannot see from the button being unavailable.
        disabled: !profileId || templates.length === 0,
      },
      {
        label: "Save as Template",
        icon: "upload",
        onClick: () => setNaming(true),
        disabled: !profileId,
      },
      { label: "CSV", icon: "download", onClick: exportCsv },
      { label: "PDF", icon: "download", onClick: printBudget },
    ],
    [profileId, templates.length, exportCsv],
  );

  return {
    actions,
    isPickerOpen,
    closePicker: () => setPickerOpen(false),
    templates,
    isLoadingTemplates: templatesQuery.isPending,
    isNaming,
    closeNaming: () => setNaming(false),
    saveAs,
    isSaving: createTemplate.isPending,
  };
}
