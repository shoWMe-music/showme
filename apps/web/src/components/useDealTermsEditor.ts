import {
  getGetApiV1EventsIdDealsQueryKey,
  getGetApiV1ProfilesIdTemplatesQueryKey,
  useGetApiV1ProfilesIdTemplates,
  usePatchApiV1DealsDid,
  usePostApiV1ProfilesIdTemplates,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import {
  TERMS_TEMPLATE_CATEGORY,
  readTermsTemplateText,
  termsTemplatePayload,
} from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";

/**
 * The TERMS & CONDITIONS editor — writing the words of an agreement, and reusing
 * them on the next one.
 *
 * The product owner asked for *"terms and conditions text box and template"* on
 * the agreement, and separately that *"we are not an agreements app"*. Both are
 * obeyed here by what is absent: this is a text box and a saved template, with no
 * clause library, no e-signature, and no document assembly — the terms print
 * through the Share & Export that already carries `agreement_body_text`.
 *
 * It lives on the Deals tab and NOT in the New-deal composer, by decision: the
 * composer states what the deal pays, and the terms are written on the tab
 * afterwards, where there is room for them.
 *
 * Templates ride on the `templates` table under `category = 'terms'` — the same
 * mechanism the Budget Planner's "Save as Template" uses (`useBudgetToolbar`), so
 * the app has one template system rather than two. Nothing here needed a
 * migration: `templates.category` has carried `'terms'` since the first one, and
 * the text itself goes in `deals.agreement_body_text`, a column that has existed
 * since the agreement was folded into the deal and until now had no writer.
 */

/** A saved terms template as the picker lists it. */
export interface SavedTermsTemplate {
  id: string;
  name: string;
  /** Replaces the text in the editor with this template's. */
  apply: () => void;
}

/** The deal whose terms are being written, as the editor needs it. */
export interface DealTermsSubject {
  id: string;
  name: string;
  /** What is stored on the deal right now, or null when nothing is written. */
  agreementBodyText: string | null;
  /** Optimistic-lock version (decisions #8) — terms must not land on moved terms. */
  version: number;
}

export interface DealTermsEditor {
  /** The deal currently open for editing, or null when the dialog is closed. */
  subject: DealTermsSubject | null;
  text: string;
  setText: (value: string) => void;
  open: (deal: DealTermsSubject) => void;
  close: () => void;
  save: () => void;
  isSaving: boolean;
  templates: SavedTermsTemplate[];
  /** True while the naming dialog for "Save as template" is open. */
  isNamingTemplate: boolean;
  startNamingTemplate: () => void;
  cancelNamingTemplate: () => void;
  saveAsTemplate: (name: string) => void;
  isSavingTemplate: boolean;
}

export function useDealTermsEditor(eventId: string): DealTermsEditor {
  const toast = useToast();
  const queryClient = useQueryClient();
  const profileId = getActiveProfileId();
  const [subject, setSubject] = useState<DealTermsSubject | null>(null);
  const [text, setText] = useState("");
  const [isNamingTemplate, setNamingTemplate] = useState(false);

  const templatesQuery = useGetApiV1ProfilesIdTemplates(profileId ?? "", {
    query: { enabled: Boolean(profileId) },
  });
  const createTemplate = usePostApiV1ProfilesIdTemplates({
    mutation: {
      onSuccess: () => {
        toast.success("Terms saved as a template.");
        if (profileId) {
          queryClient.invalidateQueries({
            queryKey: getGetApiV1ProfilesIdTemplatesQueryKey(profileId),
          });
        }
      },
      onError: (error: unknown) => toast.error(errorMessage(error, "Couldn't save the template.")),
    },
  });
  const saveTerms = usePatchApiV1DealsDid();

  const templates = useMemo<SavedTermsTemplate[]>(
    () =>
      (templatesQuery.data ?? [])
        .filter((template) => template.category === TERMS_TEMPLATE_CATEGORY)
        .map((template) => ({
          id: template.id,
          name: template.name,
          apply: () => {
            setText(readTermsTemplateText(template.payload));
            toast.success(`Loaded “${template.name}”.`);
          },
        })),
    [templatesQuery.data, toast],
  );

  const open = useCallback((deal: DealTermsSubject) => {
    setSubject(deal);
    setText(deal.agreementBodyText ?? "");
  }, []);

  const save = useCallback(() => {
    if (!subject) return;
    saveTerms.mutate(
      {
        did: subject.id,
        // An empty box CLEARS the terms rather than storing "" — a deal with no
        // terms and a deal with an empty string are the same thing, and only one
        // of them reads as absent everywhere else.
        data: {
          agreementBodyText: text.trim() === "" ? null : text,
          expectedVersion: subject.version,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdDealsQueryKey(eventId) });
          toast.success("Terms saved.");
          setSubject(null);
        },
        onError: (error) => toast.error(errorMessage(error, "Couldn't save the terms.")),
      },
    );
  }, [saveTerms, subject, text, queryClient, eventId, toast]);

  const saveAsTemplate = useCallback(
    (name: string) => {
      if (!profileId || name.trim() === "") return;
      createTemplate.mutate({
        id: profileId,
        data: {
          category: TERMS_TEMPLATE_CATEGORY,
          name: name.trim(),
          payload: termsTemplatePayload(text),
        },
      });
      setNamingTemplate(false);
    },
    [profileId, createTemplate, text],
  );

  return {
    subject,
    text,
    setText,
    open,
    close: () => {
      setSubject(null);
      setNamingTemplate(false);
    },
    save,
    isSaving: saveTerms.isPending,
    templates,
    isNamingTemplate,
    startNamingTemplate: () => setNamingTemplate(true),
    cancelNamingTemplate: () => setNamingTemplate(false),
    saveAsTemplate,
    isSavingTemplate: createTemplate.isPending,
  };
}
