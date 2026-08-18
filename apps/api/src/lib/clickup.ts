/**
 * ClickUp lead sink — forwards marketing contact-form submissions to a ClickUp
 * list as tasks. This is an external integration (like the Firebase token
 * verifier), so it is injected into the app: the route stays framework-agnostic
 * and the API token never leaves the server. When unconfigured (local/test), the
 * no-op sink just logs, so the app boots and the form works without credentials.
 */

export interface Lead {
  name: string;
  email: string;
  message: string;
  /** The "I am a…" self-selected role from the form, if provided. */
  role?: string;
}

export interface LeadSink {
  captureLead(lead: Lead): Promise<void>;
}

/** No-op sink for local/dev/test — logs the lead instead of forwarding it. */
export function createNoopLeadSink(
  log: (lead: Lead) => void = (lead) =>
    console.info("[shoWMe] lead captured (ClickUp not configured):", lead),
): LeadSink {
  return {
    async captureLead(lead) {
      log(lead);
    },
  };
}

export interface ClickUpConfig {
  apiToken: string;
  listId: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImplementation?: typeof fetch;
}

/**
 * Real sink — creates a task in the given ClickUp list. The task title carries
 * the lead's name + email so it is scannable in the list; the self-selected role
 * becomes a tag so the list can be filtered by account type (the tags must already
 * exist in the space — the account-type set is seeded there once); the description
 * holds the full message. A non-2xx response throws so the caller never silently
 * drops a lead.
 */
export function createClickUpLeadSink(config: ClickUpConfig): LeadSink {
  const doFetch = config.fetchImplementation ?? fetch;
  return {
    async captureLead(lead) {
      const response = await doFetch(`https://api.clickup.com/api/v2/list/${config.listId}/task`, {
        method: "POST",
        headers: {
          authorization: config.apiToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: `${lead.name} — ${lead.email}`,
          // Tag names are matched case-insensitively by ClickUp; lowercase to match
          // the seeded lowercase tags exactly. Omitted entirely when no role given.
          tags: lead.role ? [lead.role.toLowerCase()] : undefined,
          description: [
            lead.message,
            "",
            "— via shoWMe marketing contact form",
            `Reply to: ${lead.email}`,
          ].join("\n"),
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `ClickUp task creation failed (${response.status}): ${detail.slice(0, 200)}`,
        );
      }
    },
  };
}

/** Pick the real sink when configured, else the no-op — mirrors config.ts optionality. */
export function createLeadSink(config: {
  clickUpApiToken?: string;
  clickUpLeadsListId?: string;
}): LeadSink {
  if (config.clickUpApiToken && config.clickUpLeadsListId) {
    return createClickUpLeadSink({
      apiToken: config.clickUpApiToken,
      listId: config.clickUpLeadsListId,
    });
  }
  return createNoopLeadSink();
}
