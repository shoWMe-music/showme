# QA sweep — run 7 (2026-09-28)

**Commit under test:** `fbfdc92` · branch `main` (clean apart from this report and its screenshots).
**Stack:** the `pnpm dev` stack left running and freshly seeded — web `:5180`, API `:8080`, stream `:8081`,
marketing `:5173`, auth emulator `:9099`, Postgres `:55432`.
**Screenshots:** `docs/screenshots/qa-2026-09-28-run7/`.

## 1. What was driven

**Six genuinely independent browser seats**, not tabs. The Playwright MCP server is down, so every browser
step used **chrome-devtools MCP**; separate seats were obtained with `new_page`'s `isolatedContext`, which
gives each account its own profile and its own IndexedDB. Verified working: signing `professional@` into
one context did not disturb the `operator@` session in another, and both reacted to live SSE independently.

| Seat | Account | Context |
|---|---|---|
| 46 | `operator@` — The Lantern Hall | default |
| 47 | `professional@` — Priya Sound (crew) | `crewseat` |
| 49 | `performer.a@` — Marlo Vance | `perfA` |
| 50 | `co.host@` — Northlight Presents | `idletest` (also used for `performer.b@` in the idle-logout probe) |
| 51 | `agent@` — Astra Booking Agency | `agentseat` |
| 48 | — | marketing site, unauthenticated |

API probes used `node .claude/skills/verify-e2e/api-as.mjs`; every figure quoted was read back out of
Postgres through `docker exec -i showme-e2e-postgres psql`.

