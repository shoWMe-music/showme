import { PRESET_PERMISSION_SETS } from "@showme/auth";
import {
  AGENT_CAPABILITIES,
  CREW_SCHEDULE_ONLY_CAPABILITIES,
  OPERATOR_FULL_CAPABILITIES,
  PERFORMER_CAPABILITIES,
} from "@showme/db/seed-capabilities";
import { describe, expect, it } from "vitest";

/**
 * THE SEEDED CAPABILITIES ARE THE REAL PRESETS — asserted, because they cannot be
 * imported.
 *
 * `packages/auth` depends on `packages/db`, so the seeds cannot read
 * `PRESET_PERMISSION_SETS` without turning that arrow into a cycle. The bundles are
 * therefore a hand copy in `@showme/db/seed-capabilities`, and a hand copy drifts:
 * three capabilities have now gone into a preset without reaching the seeds
 * (`rider.view` in `e5928ec`, `performance_report.file`, and `rider.submit` today for
 * ClickUp `123qy9rnk1u`). Every time, the suites stayed green and the feature looked
 * broken in the browser — which is the worst possible pairing, and it happened
 * because nothing anywhere compared the two lists.
 *
 * THIS is that comparison. An app may depend on both packages, so the test lives
 * here rather than in either of them. It needs no database and no app: it is two
 * arrays.
 *
 * Order is compared too, sorted — the values are a set in meaning, so a reordering
 * is not a defect, but a missing or extra one is.
 */
const sorted = (capabilities: readonly string[]) => [...capabilities].sort();

describe("the seeds write exactly the preset they name", () => {
  it("operator_full", () => {
    expect(sorted(OPERATOR_FULL_CAPABILITIES)).toEqual(
      sorted(PRESET_PERMISSION_SETS.operator_full),
    );
  });

  it("performer", () => {
    expect(sorted(PERFORMER_CAPABILITIES)).toEqual(sorted(PRESET_PERMISSION_SETS.performer));
  });

  it("crew_schedule_only", () => {
    expect(sorted(CREW_SCHEDULE_ONLY_CAPABILITIES)).toEqual(
      sorted(PRESET_PERMISSION_SETS.crew_schedule_only),
    );
  });

  it("agent", () => {
    expect(sorted(AGENT_CAPABILITIES)).toEqual(sorted(PRESET_PERMISSION_SETS.agent));
  });

  /**
   * The bundles the seeds do NOT carry, named so this file says what it does not
   * cover. Each is a tier no seeded account stands in, so there is nothing to keep
   * in step — and the moment a seed uses one, it belongs above.
   */
  it("names the presets no seed uses, so the gap is deliberate", () => {
    const seeded = new Set(["operator_full", "performer", "crew_schedule_only", "agent"]);
    const unseeded = Object.keys(PRESET_PERMISSION_SETS).filter((name) => !seeded.has(name));
    // Two, and both are tiers an operator GRANTS rather than tiers an account has:
    // `crew_technical` is the transparency dial for one crew person (decisions #12)
    // and `view_only` is the floor-plus-nothing set. No seeded account stands in
    // either, so there is nothing for them to be out of step with.
    expect(unseeded.sort()).toEqual(["crew_technical", "view_only"]);
  });
});
