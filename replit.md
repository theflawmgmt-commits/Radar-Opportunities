# RADAR

RADAR helps creators, freelancers, founders, and small businesses find specific opportunities worth contacting and understand why each one is relevant.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/radar/src/App.tsx` — routed product shell and primary user flows
- `artifacts/radar/src/index.css` — RADAR visual tokens and responsive styling
- `artifacts/api-server/src/routes/radar.ts` — API handlers for dashboard, Radars, leads, outreach, pipeline, and activity
- `artifacts/api-server/src/services/radar-data.ts` — normalized demo dataset and in-memory demo state
- `artifacts/api-server/src/services/providers.ts` — provider interfaces for future search, enrichment, and verification integrations
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/radar.ts` — PostgreSQL schema for Radars, leads, and outreach

## Architecture decisions

- The first release is explicitly demo mode: all sample companies and evidence are fictional and marked as demo data.
- The API is contract-first through OpenAPI and generated clients; the UI does not own discovery or outreach logic.
- Demo state is held in a normalized provider-shaped service so the first connected search/enrichment provider can replace it without changing the UI contract.
- Outreach drafts can be approved or edited in the app, but `canSend` remains false until a real sending integration is connected.

## Product

The MVP supports Home, Create Radar, Discover, Lead Detail, Outreach, Pipeline, Saved Radars, and Settings. Users can define an opportunity search, inspect evidence-backed fictional leads, create personalized drafts, approve or skip drafts, and move leads through a lightweight pipeline.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Do not present demo companies as real companies or imply web research, contact verification, scraping, or message sending is connected.
- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`.
- Use the managed artifact workflows for preview; the Vite build expects workflow-provided `PORT` and `BASE_PATH`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
