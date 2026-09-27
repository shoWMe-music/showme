/**
 * THE CAPABILITY BUNDLES THE SEEDS WRITE — one copy, pinned to the real presets.
 *
 * A seeded `permission_sets.capabilities[]` has to say the same thing as
 * `PRESET_PERMISSION_SETS` in `@showme/auth`, and it cannot simply IMPORT it:
 * `packages/auth` depends on `packages/db`, so the arrow cannot also point back.
 * Hence a hand copy — which is exactly the kind of duplicate that rots.
 *
 * It rotted three times. `rider.view` was added to `operator_full` in `e5928ec`
 * and not here, so every seeded operator silently lacked it for weeks and the
 * share dialog's rider tick-box was dead on the only stack anybody drives by
 * hand. `performance_report.file` went the same way. And `rider.submit` did it
 * again today (ClickUp `123qy9rnk1u`) — the capability reached the preset, the
 * suites went green, and the Upload button still did not appear in the browser.
 *
 * Two changes end that pattern, and neither needs the import cycle:
 *
 *  1. **One copy instead of two.** `seed.ts` and `seed-e2e.ts` each carried their
 *     own `operator_full` list. They now both read this module, so the two stacks
 *     can no longer disagree with each other on top of disagreeing with the preset.
 *  2. **A test that fails on drift.** `apps/api/src/seed-presets.test.ts` imports
 *     this module AND `@showme/auth` — an app may depend on both — and asserts
 *     each bundle equals the preset it names. A capability added to a preset and
 *     not here now fails a suite at the moment of introduction instead of becoming
 *     a feature that looks broken in the browser and green in CI.
 *
 * So: add a capability to `PRESET_PERMISSION_SETS`, then add it HERE. The test
 * will tell you if you forget, which is the whole point of the file.
 *
 * Typed as `string[]` rather than `Capability[]` on purpose — the `Capability`
 * union lives in `@showme/shared` and the equality test is what checks the values,
 * so importing a type here would buy nothing this file does not already have.
 */

/** `PRESET_PERMISSION_SETS.operator_full`. */
export const OPERATOR_FULL_CAPABILITIES: string[] = [
  "event.view",
  "event.edit",
  "event.delete",
  "event.publish",
  "event.send_info_email",
  "participants.manage",
  "deal.view.own",
  "deal.edit",
  "budget.view",
  "budget.edit",
  "revenue.edit",
  // An operator sees every rider on their own event…
  "rider.view",
  // …and attaches their own documents to it: the venue's technical info, its
  // equipment list, its house rules (ClickUp `123qy9rnk1u`).
  "rider.submit",
  "settlement.view.own",
  "settlement.edit",
  "settlement.confirm",
  "settlement.finalize",
  "schedule.view",
  "schedule.edit",
  // The operator's half of the setlist module — the PRO filing.
  "performance_report.file",
  "crew.manage",
  "agreement.manage",
  "agreement.confirm",
  "message.post",
];

/** `PRESET_PERMISSION_SETS.performer`. */
export const PERFORMER_CAPABILITIES: string[] = [
  "event.view",
  // The act can put its own show's public page up, and take it down
  // (ClickUp `123qy9rpe3q`).
  "event.publish",
  "deal.view.own",
  "settlement.view.own",
  "settlement.confirm",
  "rider.submit",
  "schedule.view",
  "setlist.author",
  "message.post",
];

/** `PRESET_PERMISSION_SETS.crew_schedule_only` — the floor-plus-nothing tier. */
export const CREW_SCHEDULE_ONLY_CAPABILITIES: string[] = ["event.view", "schedule.view"];

/**
 * `PRESET_PERMISSION_SETS.agent` — negotiate and approve on the performer's
 * behalf. Budget/pool capabilities are un-grantable to an arm's-length party and
 * would be stripped by the ceiling (`isGrantable`) even if they were listed.
 */
export const AGENT_CAPABILITIES: string[] = [
  "event.view",
  // Publish for the act they represent — a delegated performer has no band of their
  // own, so this is the only way a represented act's show reaches its public page
  // without the operator doing it (ClickUp `123qy9rpe3q`).
  "event.publish",
  "deal.view.own",
  "deal.edit",
  "settlement.view.own",
  "settlement.confirm",
  "agreement.manage",
  "agreement.confirm",
  "schedule.view",
  "message.post",
  "crew.submit",
];
