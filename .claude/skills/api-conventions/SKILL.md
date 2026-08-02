---
name: api-conventions
description: How the shoWMe API is built — Fastify + Zod + Drizzle on Cloud Run, the request pipeline, route/plugin conventions, naming, and the SSE realtime channel. Use when adding or changing API routes, plugins, or the request lifecycle.
---

# API conventions

Full route map in [PLAN.md](../../../PLAN.md) → "API route map". Base `/api/v1`.

## Stack
- **Fastify** + **`fastify-type-provider-zod`** — Zod schemas validate requests/responses *and* infer handler types.
- **Drizzle** + **`drizzle-zod`** — typed SQL; derive Zod from tables so DB shape & validation don't drift.
- **`firebase-admin`** — verify the Firebase ID token in a `preHandler` hook.
- **`@google-cloud/cloud-sql-connector`** + a **small per-instance pool** (2–5), capped max-instances (the one Cloud Run gotcha).

## The pipeline (every non-public route)
`verify Firebase token → resolve principal once → authorize(capability, resource) → Zod validate → handle (Drizzle) → serialize(capabilities) → audit if sensitive`
- Acting profile via **`X-Profile-Id`** header (validated ∈ memberships).
- **List routes fold the access predicate into the SQL** — the `WHERE` *is* the rule (one query, no N+1, no per-row check) + cursor pagination.
- Public/token routes skip the principal and use a whitelisted-column serializer.

## Structure
One Fastify **plugin per domain** (events, deals, budget, settlement, profiles, invitations, contacts, inbound, shares, plans, calendar/tasks). A central **auth plugin** and a single **`authorize()` policy module** (the only place rules live). Business logic (settlement, holds) = plain TS modules the handlers call — framework never touches the math.

## Realtime
`GET /stream` — one multiplexed **SSE** connection per user (chat + notifications + event-change updates), driven by Postgres **`LISTEN/NOTIFY`**. Client **sends** via normal `POST` (e.g. `POST /events/:id/messages`), **receives** via the stream — no WebSocket. Runs on a **dedicated Cloud Run service** (bypasses Firebase Hosting's CDN, which buffers/timeouts SSE).

## Auth wiring
Firebase token carries only `uid`. Verify → JIT-provision `users` → resolve principal from Postgres. No custom claims. `api.` subdomain (Bearer-token auth + CORS); `stream.` subdomain direct to Cloud Run.

## Naming (enforced)
**Full words, no abbreviations.** `authorize(capability)` not `authorize(cap)`; `capabilities` not `caps`; `entitlement` not `ent`. Readable at a glance.

## Route tags in the map
`(capability)` = required authorization capability · `[entitlement]` = plan/billing gate (checked after authorize).
