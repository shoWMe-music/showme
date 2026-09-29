# Urgent board loop — 2026-09-29, part 27

Part 26 reached 419 lines and closed two of qa-sweep run 11's five MAJORs: **QA11-1** (a deal's
figures sealed at the first signature, not the last) and **QA11-5** (the Issue button's missing
amount guard). Three MAJORs remain, and they are related in a way worth saying before starting:
**all three are about a co-operator, and two of them are the same seat reading a document that is
not true of it.**

| Finding | The shape of it |
|---|---|
| QA11-2 | The host's settlement omits the co-operator and still reads as a complete document |
| QA11-3 | A co-operator can be served a settlement, counted in the roster, and can never approve it |
| QA11-4 | *"Sign your line on…"* dead-ends, on both seeded deals — and the seed authored the state |

Run 11's own list, for the record: **5 MAJOR · 12 MINOR · 4 COSMETIC · 5 NOTE**, with eight of the
nine things parts 25–26 landed re-verified and passing.
