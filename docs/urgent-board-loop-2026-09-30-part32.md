# Urgent board loop — part 32 (2026-09-30)

Part 31 closed at 387 lines. Nine of run 12's eleven findings are shut — the MAJOR (`7dc1f3d`), the
deals-data pair (`76e657b`), the attention card's two (`4740791`), the Outgoing tab (`0d8723a`), the
Projections caption (`bf128f0`), the approval roster (`2e77e65`) and the awaiting-signature route
(`cfb6164`). **Two left, and they are the last two.**

## 1. [MINOR] A 409 written for an API caller, printed to a venue operator — run 12 §2 line 175

**What was measured**, as a toast on the Deals tab:

> "A party has already signed this agreement, so **agreementBodyText** cannot change — their
> signature is on the figures as they stand. Reopen it for renegotiation first, which tears every
> signature up: **POST /deals/36ff1176-1333-4f85-bdbb-383bad290d67/reopen**"

A field name and an HTTP route, to a promoter.

**Which file settles it — and NOT by changing the server string.** That message is deliberately
written for an API caller: it names the route to call next, which is exactly right for the
assistant/agent-native surface (decisions #16.14), and `routes/deals.ts:939-943` is the only place it
exists. The defect is that the browser prints it.

**And `errors.ts` already holds the answer, twice over.** It maps a 403 to
*"This part of the event isn't shared with you…"* and it does so **matched on the code, never on the
message text** — with its own docstring explaining why: *"Matching on the code — never on the message
TEXT — is what lets ONE component answer every plan gate in the app without a copy of the upgrade
sentence in each screen."* `ENTITLEMENT_REQUIRED_CODE` is that pattern's precedent: two 403s that look
identical on the wire, told apart by a code.

**THE OBVIOUS FIX IS WRONG, AND THE FILE SAYS SO.** Matching `code === "conflict"` and substituting a
sentence would destroy four good ones. Every 409 the deals route throws:

```
939  the sealed terms         ← names a field and a route. THE ONE to replace
977  "Deal was changed by someone else; reload and retry"
1047 "Only a draft agreement can be sent"
1293 "Only an agreement somebody has signed can be reopened"
1469 dealDeletability's own sentence (§25.7.2, written for a person)
```

All four of those are already plain English addressed to the reader. A blanket map would be the
"**BEFORE FOLLOWING A REPORT'S SUGGESTED FIX, CHECK WHAT THE LINE IS LOAD-BEARING FOR**" lesson for
the third time this stretch.

**So: a distinct code, exactly as the plan gate has one.** `TERMS_SEALED_CODE = "terms_sealed"` on the
API side; `errors.ts` maps it to a sentence a promoter can act on and names the control that IS on the
card. The API caller's message is untouched, and so are the other four 409s.

**The scope.** A `HttpError` code on the one throw, the constant shared the way
`ENTITLEMENT_REQUIRED_CODE` is (declared on each side with the comment pointing at the other), a
`sealedTermsRefusal` branch in `errorMessage`, and tests for both halves. **Unreachable through the UI
since `7dc1f3d`** — the editor is withdrawn at the first signature — but reachable in a race between
two tabs, which is precisely when a stranded reader most needs a sentence rather than a route.

## 2. [COSMETIC] `favicon.ico` 404s on every page load — run 12 §2 line 345

**Which file settles it:** `apps/web/index.html`, and **the asset already exists.**
`apps/marketing/public/favicon.svg` is the brand mark — 398 bytes, the dark rounded square with the
coral arch and the sand triangle — and `apps/marketing/index.html:1349` links it. The app never did,
so every load asks for the default `/favicon.ico`, gets the SPA's 404, and logs the only non-2xx in
the entire sweep that was not an expected pre-sign-in Firebase 400 or a deliberate authorization
probe. Both cold-load console errors come from it.

**The verdict: not a new asset — the same one.** A second hand-drawn mark would be a divergence
waiting to happen, and this repo already has a rule about that (*nothing hand-rolls what the design
system has*). The file is copied into `apps/web/public/` with a comment naming its source, because two
Vite apps have two `public/` roots and a symlink there is fragile in a container build.

**The scope.** The asset, one `<link rel="icon">`, and nothing else. No decision.

---

## What landed — both, and the race reproduced

The 409 still says the same thing to an API caller, and now carries a code:

```
$ api-as.mjs operator PATCH /deals/<d1> '{"agreementBodyText":"QA32 probe"}'
409 { "code": "terms_sealed",
      "message": "These terms are frozen — agreementBodyText cannot change on a confirmed
                  agreement. Reopen it for renegotiation first: POST /deals/<d1>/reopen" }
```

And the toast, read live **in the actual race** — the terms dialog open with unsaved text, a signature
landing from another seat, then Save:

```
BEFORE  "A party has already signed this agreement, so agreementBodyText cannot change — their
         signature is on the figures as they stand. Reopen it for renegotiation first, which tears
         every signature up: POST /deals/36ff1176-1333-4f85-bdbb-383bad290d67/reopen"

AFTER   "A party has already signed this agreement, so its terms are fixed. Reopen it to
         renegotiate — that clears every signature and asks the parties again."
```

`favicon.svg` serves 200 from the app's own origin.

### MY FIRST ATTEMPT AT THAT RACE REPORTED SUCCESS AND PROVED NOTHING

The toast came back **"Terms saved."** — and the database said otherwise:

```
agreement_status | terms  | version
sent             | (null) |       7      ← unchanged
```

The probe's selector was `'dialog textarea, [role="dialog"] textarea, textarea'`, and
`querySelector` returns the first match **in document order across the whole list** — not the first
match of the first selector. It filled a textarea on the page *behind* the dialog, so the PATCH
carried no changed field, the guard had nothing to refuse, and the save legitimately succeeded.

**A GREEN TOAST IS NOT EVIDENCE THE THING UNDER TEST RAN.** This is CLAUDE.md's own "green is not the
same as correct" one layer out: the check passed because it measured the wrong element, and only
reading the row behind it said so. The second attempt asserted `insideDialog: true` and the textarea's
value before touching Save — and then the 409 arrived.

### Mutations — five, all killed

| Mutation | Verdict |
|---|---|
| the mapping never fires — the defect | KILLED (2) |
| **matched on `code === "conflict"` — the blanket rewrite** | **KILLED (4)** |
| matched on the STATUS instead of the code | KILLED (2) |
| the sentence stops naming the Reopen control | KILLED (1) |
| it runs after the permission branch, so a 403 would win a 409 | KILLED (2) |

The second row is the finding's real content: the obvious fix fails **four** tests, because the deals
route's other 409s are already plain English addressed to their reader. Third time this stretch that
checking what a line is load-bearing for changed the answer.

Suites: biome 748 files · web 602 (was 597) · API `deals` 83.

---

## 3. The full pass — stack down, one go

All eleven of run 12's findings closed, so this is the reconciliation.

| Suite | Result | Against |
|---|---|---|
| `npx biome check .` | **748 files**, no errors | repo-wide, not per file |
| `@showme/shared` | **344** | 343 before this stretch (+1, the observer-signature case) |
| `@showme/auth` | **36** | unchanged |
| `@showme/settlement` | **74** | unchanged |
| `@showme/db` | **25** | unchanged |
| `apps/web` | **602** | 546 at the start of the stretch |
| `apps/api` | **1469** across 65 files, **0 failed** | 1460 before this stretch |
| `pnpm test:e2e` | **116**, including all four of `tests/motion.spec.ts` | 116 |

The API run lost **one** file to the Testcontainers port-bind flake (`settlement-own-read`, reported as
14 *skipped* with zero failures — the tell), re-run alone: 14 passed. 1455 + 14 = 1469.

The web total grew by 56 across the stretch and the API by 9; both are this stretch's new tests, and
every one of them exists because a mutation or a live probe asked for it rather than because a file
was being tidied.

### The stack afterwards

`pnpm test:e2e` removes the docker postgres on the way out, so `pnpm dev` rebuilt it — which means the
fixtures are **pristine** without needing the manual FK sweep at all. Verified rather than assumed:

```
events not e2e%              0
deals not e2e%               0
participants on e4           1        (the seeded one, not the probe's Marlo)
settlement_approvals         0
settlements                  3
Album Release — Door Split   [confirmed/confirmed] 3/3   hidden=0
/favicon.svg                 200
```

Seven orphaned postgres containers from the interleaved runs were pruned; one remains, which is the
stack's own.
