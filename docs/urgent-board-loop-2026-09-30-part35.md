# Urgent board loop — part 35 (2026-09-30)

Continues part 34 (340 lines), which closed **every** run 13 finding.

---

## 1. A copy sweep — the app reads as though one machine wrote every hint

**Asked for mid-tick:** *"do a sweep and change obvious AI text. I.e. — marks or too bloated
explanations."*

### Measured first

956 non-comment lines in `apps/web`, `apps/api`, `apps/marketing` and `packages/*` carry an em or en
dash. Most are **not** the problem: `"Marlo Vance — Album Release"` is a label separator the design
uses and the fixtures and tests pin. Narrowing to *prose strings of nine words or more where a
spaced dash joins two clauses* gives **216**, and that is the real finding: the dash is not wrong in
any one of them, it is that **every hint in the app is built the same way**. A human writer varies.

### What is deliberately NOT changed

**API error messages that name a field or a route.** `apps/web/src/lib/errors.ts` and
`apps/api/src/errors.ts` already argue this out: that vocabulary is *right* for an API caller and for
the agent-native surface (decisions #16.14) and *wrong* on a toast, which is why `TERMS_SEALED_CODE`
exists at all — one code, and the client turns it into a sentence a promoter can act on. Gutting
those messages would undo a fix and weaken the surface #16.14 is for. Same for
`lib/config-audit.ts`, which is a developer's report.

So the line is not "dash bad". It is **whose sentence is it** — and the defect is developer
vocabulary or unbounded explanation reaching a *person*.

### Pass 1 — where it reaches a person (this section)

| Where | What was wrong |
| --- | --- |
| `useProfileImageUpload.ts`, `useRiderUpload.ts` | *"This is usually a missing CORS policy on the storage bucket."* — in a toast. A performer uploading a stage plot cannot act on it. |
| `lib/event-delete.ts` | *"Switch to it (X-Profile-Id)"* — an HTTP header name in a refusal the web shows verbatim. |
| `routes/settlement.ts` `unsettlableLine` | the DELETE route mid-sentence, inside the dashes. The route STAYS (its comment says why) and stops interrupting the sentence. |
| `EventDetail.tsx`, `useEventCollaborators.ts`, `EventInlineInformation.tsx`, `ProfileRoomsCard.tsx`, `HoldPlacement.tsx`, `email-templates.ts`, `SettlementActualsCard.tsx`, `RequestTriageDialogs.tsx`, `lib/deal-confirmation.ts` | the longest prose on screen, each a three-or-four-clause sentence held together by a dash. |
| `lib/errors.ts` | **both sealed-terms sentences, written earlier today.** They are the newest instance of exactly the pattern being swept. |

Pass 2 — the ~190 remaining short hints — is mechanical and follows, in batches, with the suites run
between each.

### Pass 1 — done

17 strings. The two storage toasts now put the **diagnosis in `console.warn` and the sentence in the
toast**, which is the better engineering as well as the better copy: a performer uploading a stage
plot cannot fix a bucket's CORS policy, and whoever is running the stack still gets the clue.
`event-delete.ts` loses `(X-Profile-Id)`. `unsettlableLine` keeps its route — its own comment says
why, and #16.14 wants it — but the route stops interrupting the sentence: an operator reads the first
two sentences and stops, a caller reads the third.

Both sealed-terms sentences were written earlier today and are the newest instance of the very
pattern. **`errors.test.ts` passed unchanged** through the rewrite, which is the payoff for asserting
the *trigger* rather than the wording — the test says "names one signature, never says everyone,
names reopening and its cost", and all of that survived a complete rewording.

### Pass 2 — 161 strings across 88 files, punctuation chosen by SHAPE

A blanket dash→period substitution would have swapped one uniform tic for another. So the
transformation varies with what the sentence actually is:

| Shape | Punctuation | Count |
| --- | --- | --- |
| noun phrase → its description (`"Optional — what you would bring"`) | colon | 44 |
| two independent clauses | two sentences | ~100 |
| a coordinating or subordinating continuation (`and`, `so`, `unless`, `with`, `never`) | comma | 11 |
| a bracketed aside (`"the ledger — and this figure — covers…"`) | parentheses | 6 |

Five strings are hand-authored overrides where no rule gave good English —
`"On — moves up if a hold above it falls"` became `"On, so it moves up…"`; the performer placeholder
became `"Search for a performer, or type a name…"`.

**Three rules had to be corrected against their own output**, which is why every proposal was read
before anything was written:

1. the aside → parentheses branch **dropped the space** after the closing bracket
   (`"…a shared cost)but never more"`), because the second dash's trailing space was being consumed;
2. splitting on a tail that begins `with` / `unless` / `segmented` left a **fragment**
   (*"…will show here. With status and amount."*);
3. a comma after a complete clause left a **splice** (*"There is nothing to report, no performer has
   written a setlist yet."*) — so `without`, `no`, `not`, `that`, `its`, `their` and any tail under
   three words route to a colon instead.

Developer log lines (`[shoWMe] …`) are excluded, and so are the 37 strings in the API-caller files
named above.

### Four tests pinned the old wording

`attentionList` (the caught-up line), `eventProjection` (the co-operator note), `useTeamAccess` (the
seat refusal) and `deal-terms` (the band-needs-a-split refusal). All four updated — they assert exact
copy on purpose, and each is a sentence whose *wording* is the thing under test.

### A blocker the sweep found by accident, in my own commit from an hour earlier

The browser check on the rewritten copy came back with an **empty page**. The console said:

> `Uncaught Error: Module "node:util" has been externalized for browser compatibility. Cannot access
> "node:util.isDeepStrictEqual" in client code.`

Not the copy. **`c9ffa7f`** — moving `sameBreakdown` into `packages/settlement/src/snapshot.ts`
carried `import { isDeepStrictEqual } from "node:util"` into a package the **web** reaches, and Vite
externalises a Node builtin for the browser. Every screen white.

`tsc --noEmit` was clean on both apps and **2,588 unit tests passed**, because vitest runs in Node.
Nothing in the suite could see it. This is CLAUDE.md's own lesson arriving from a new direction: not
"green is not correct" about an assertion, but a whole class of defect no assertion in the repo is
positioned to make — and the only reason it was caught within the hour is that a browser check was
already scheduled for something else.

Fixed in `ee9acc4`: the comparison is spelled out in the package, and the property its docstring had
always claimed — by value, not by key order — now has the test it never had. Measured as the only
Node import across `@showme/settlement`, `@showme/shared` and `@showme/auth`, so nothing else is
exposed the same way.

### Suites, after both

`npx biome check .` **756** clean · shared **349** · web **622** · settlement **80 → 82** ·
auth **37** · db **25** · **API 65 files, 1475 passed, 0 failed, 0 skipped** · `tsc --noEmit` clean.

Browser, co-host dashboard: renders, and the only two em dashes left on the page are inside
`"Marlo Vance — Album Release"` — the event-title separator, which is the typography the sweep
deliberately keeps.

