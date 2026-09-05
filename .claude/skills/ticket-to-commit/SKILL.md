---
name: ticket-to-commit
description: The delivery loop for any work that came from a ClickUp ticket — check the ticket against the code before scoping, build, prove it live, write the finding back to the ticket, and commit naming it. Use whenever picking up, planning, fixing or closing a board item, and before reporting a ticket as done. Pairs with clickup-tasks (where the board is), clickup-workflow (how to write to it safely) and verify-e2e (how to prove it).
---

# From a ticket to a commit

The loop every board item goes through. It exists because the expensive mistakes
here are not in the code — they are in **building the wrong thing from a
confidently-worded ticket**, and in **finishing work nobody can later trace back
to why**.

Measured on 2026-09-04: of twenty open bug tickets read against the code, **nine
did not say what they appeared to say.** One `low`-priority ticket was the root
cause of an `urgent` one. One urgent ticket was ~90% already shipped. Three
separate urgent tickets were one missing mechanism. None of that is visible from
the board.

---

## 1. Read the ticket. Then go and check the code.

**A ticket is a report of a symptom by someone who cannot see the code.** It is
evidence, not a specification. CLAUDE.md already says trusting stale prose cost a
full session; a ticket is prose with a due date on it.

Before scoping anything, answer: **which file settles this?** Name it. If you
cannot name one, you have not checked.

Expect one of these, and say which:

| Verdict | What it means | What you do |
|---|---|---|
| **Real, cause found** | The defect is there and you can point at the line | Fix it |
| **Already done** | Shipped since the ticket was written | Verify and close — do not rebuild |
| **Mis-scoped** | The real work is different, usually bigger | Re-scope, and **retitle the ticket** |
| **Several tickets, one cause** | Two or three reports of one hole | Say so; build once |
| **Decision, not defect** | The code does this deliberately, and the reason is written down | Surface the argument, let the owner decide |
| **Cannot settle from the code** | The path looks correct | Reproduce live before planning — do not guess |

### The checks that repeatedly pay

- **Open the attachments.** A ticket reading only *"See comment. This is Venue UI.
  remove it."* was unresolvable until the screenshot was downloaded and looked at
  — it identified the exact card in one glance. Screenshots are evidence; treat
  them as such.
- **Read what is already ticked.** Ran ticks items as he goes. Half of a "nothing
  works" list is often done.
- **Grep for the rule before writing one.** `occupiedDates` implemented the exact
  room-scoped availability rule a ticket asked for, with its own tests — it was
  simply never called on the write path. The hardest-sounding ticket was the
  smallest job on the board.
- **Check the dates.** A ticket written from older notes describes a state that
  may already be gone.

---

## 2. Build

Ordinary work, with three habits specific to this repo:

- **Reuse the rule that exists.** If the logic is in `@showme/shared`, call it;
  do not restate it in a route. A second copy of a rule is a future disagreement.
- **Do not spread a bug while fixing its neighbour.** Wiring a user's currency
  preference into every selector was the obvious next step — and one of those
  selectors relabels money without converting it, so the "obvious" change would
  have made a mislabelling the default for everyone. It was left alone, with a
  comment saying why, and filed separately.
- **A new bug found on the way gets filed, not silently fixed or silently
  ignored.** File it with the two or three ways out and a recommendation. Put a
  comment at the site so the next person does not "finish the job".

---

## 3. Test what can actually fail

Unit-test the pure core (`packages/shared`, `apps/web/src/lib`, `apps/api/src/lib`).
`apps/web` has a vitest project — `pnpm --filter @showme/web test:unit`.

**Then break the implementation and confirm the tests go red.** Not optional for
anything with real arithmetic. Range-splitting date logic passed on first write,
which proves the code — a deliberate wrong implementation turning four tests red
is what proves the *tests*.

Read CLAUDE.md's "Green is not the same as correct": ask what each check is
CAPABLE of failing on. A suite pinned to the wrong timezone cannot fail on a
timezone bug.

---

## 4. Prove it against the running stack

Follow **verify-e2e** (the standard) and **app-walkthrough** (the browser half).
Two things this loop adds:

**Driving it changes the design.** A conflict warning passed every unit test and
then said *nothing* on the screen for a night whose main room was sold — because
another room was free, so the venue was not "full". Technically correct, useless,
and only visible by clicking through it. A third message tier came out of that.

**Probes lie, in both directions.** A check that "another user does not read SEK"
passed nothing: the seed gives *every* user SEK, so it was true whether the route
was correct or leaking. When a probe passes, ask what would have made it fail.
When it fails, check the data before believing it.

**Run the FULL browser suite before a deploy that changes UI behaviour, not
after.** `pnpm test:e2e` — unpiped, or read the summary line, never the exit code
(CLAUDE.md). On 2026-09-04 a modal guard went out after typecheck, unit tests and
a live walkthrough, none of which press Escape. Four specs already asserting the
broken rule went red on the next full run, *days* after it reached production.
The suite had the answer the whole time; nobody asked it.

**A behaviour flag ships with a test or it does not ship, and the test asserts
BOTH halves.** That guard (`dismissOnScrim`) turned off the scrim click and the
Escape key together, fixing "a stray click discards my form" by creating "a phone
cannot leave this dialog" — which the same spec file calls the worse of the two.
A test proving only that the scrim is ignored would have stayed green through it.
Pin what the flag stops *and* what it must leave working; one half alone leaves
the flag free to be wrong in the other direction.

---

## 5. Write the finding back to the ticket

Follow **clickup-workflow** for the mechanics (never parallel writes; comment
first, then status). What goes IN the comment is this skill's business.

A good comment answers four things:

1. **What was actually wrong** — in their words where possible, then the cause.
   *"It was saving. Every time. `GET /me` never returned the values"* tells the
   reporter why they saw what they saw.
2. **What was already done** before you started, so they are not deciding about
   finished work.
3. **What you deliberately did NOT do, and why.** This is the half that gets
   skipped and the half that prevents the next person undoing your reasoning.
4. **What still needs them** — as a question with the argument on both sides, not
   a bare question. If the code takes a deliberate position against what they
   asked for (no third-party map requests; a side box that shows blocks outside
   the visible month), give them the reasoning and a middle path, then let them
   decide. It is their product.

**Status honestly.** `in review` = code done, not deployed. Nothing local-only is
`shipped`. If a ticket is 8-of-9 done, split the ninth out rather than closing it
whole or leaving it open whole.

---

## 6. Commit, naming the ticket

**Branch first if you are on `main`.**

**One ticket per commit** wherever the files allow it. That is what makes the
ticket id in the message worth anything.

Every message carries:

```
area: what changed, in the imperative

ClickUp <id> (https://app.clickup.com/t/<id>)

WHY. What was wrong, what the fix is, and what was decided against — the
reasoning that is not visible in the diff.

What was verified, and what was NOT.
```

- **The body is the why.** The diff already says what.
- **Say what is unverified.** A terraform change that could not be planned locally
  says so in its own commit message, at the point somebody would act on it.
- **Generated artifacts get their own commit.** A regenerated API client spans
  several tickets and cannot be split along them without leaving the spec and the
  client disagreeing at every intermediate commit. Say that in the message.

### The trap that will bite you

**`git status` before every `git add`.** A rename staged earlier in the session —
a `git mv` from an hour ago — is still in the index and will ride along into a
completely unrelated commit. Two test-file moves ended up inside an infrastructure
commit exactly this way. `git add <explicit paths>` does not unstage what is
already there.

After each commit, check what actually went in:

```bash
git show --stat --name-status HEAD | tail -20
```

If it is wrong: `git reset --soft <base> && git reset` puts everything back in the
working tree with nothing staged, and you can redo it deliberately.

**Watch for incidental deletions too.** Cleaning up scratch files can remove
tracked ones (`.playwright-mcp/` artifacts are committed in this repo). Restore
anything you did not mean to change: `git checkout -- <path>`.

---

## The shape of a good report back to the human

Lead with what changed about the *understanding*, not the line count. "Nine of
twenty tickets do not say what they appear to say" is the finding; the fixes are
the consequence. Then: what was built, what was deliberately not, what is
unverified, and what you need from them.
