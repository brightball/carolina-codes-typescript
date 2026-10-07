# Polyglot language API

Instructions for the finished **TypeScript** read-only HTTP API that the Carolina Code Conference Elixir site can rotate onto.

This repository is one sibling in the polyglot fleet. It is not the forkable starter. The starter ships a Postgres catalog, seed images, and a placeholder runtime. This tree ships the TypeScript process only.

The **source of truth** for routes and payloads is the CMS contract: `priv/api/openapi.yaml` and `priv/api/AGENTS.md` in the Phoenix CMS (`github.com/brightball/carolina-codes`). This repo has no `openapi.yaml`, `db/`, `images/`, or Compose catalog. If the public contract changes, change it in the CMS. Do **not** implement Ash JSON:API (`application/vnd.api+json`). Siblings speak ordinary JSON over the v1 REST + SQL-view contract.

You do **not** need a checkout of the Elixir CMS to run handler tests. Registration is best-effort: if `CAROLINA_URL` is unset or the POST fails, log and keep serving.

## Agent memory

Before an architectural edit, read `DECISIONS.md` and `MEMORY.md`.

- A new durable decision (a choice a later agent must not reverse casually) is appended to `DECISIONS.md` with status, context, decision, and consequences. Name the alternatives you rejected.
- A new command, version pin, or gotcha goes in `MEMORY.md`.
- Do not copy the decision log into `MEMORY.md`, and do not put commands or pins in `DECISIONS.md`.

Accepted records in `DECISIONS.md` are binding. If a task conflicts with one, stop and update that record in the same change. Git history is the changelog. Do not store tokens, production DSNs, or non-public hostnames in either file.

## Purpose

The Phoenix app (`Carolina.Polyglot`) keeps **at most one** language API warm and reads speakers and sponsors from it. With no APIs registered, it falls back to Ash. This process must:

1. Query PostgreSQL `v1_*` views only, never Ash tables.
2. Expose the starter route set below.
3. **Register once on boot** with the Elixir site (no heartbeat). If the site is not running, log and keep serving.

## Environment

| Variable                  | Example                                                    | Role                                            |
| ------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `DATABASE_URL`            | `postgres://postgres:postgres@127.0.0.1:5432/carolina_dev` | SQL views in the CMS database                   |
| `CAROLINA_URL`            | `http://127.0.0.1:4000`                                    | Elixir site (optional; register no-ops if down) |
| `POLYGLOT_REGISTER_TOKEN` | `dev`                                                      | Register token. Local value is `dev`.           |
| `PUBLIC_BASE_URL`         | `http://127.0.0.1:4011`                                    | URL Elixir will call                            |
| `PORT`                    | `4011`                                                     | Listen port. The container default is `8080`.   |

Live HTTP against the views uses Postgres 16 in the CMS database. This repo does not ship the starter's Postgres 18 Compose catalog. Handler tests that use the fake catalog do not need Postgres.

The server appends `sslmode=disable` when `DATABASE_URL` has no `sslmode`. See `MEMORY.md` before changing that.

## SQL views (query these)

`v1_speakers`, `v1_sponsors`, `v1_years`, `v1_talks`, `v1_sponsorships`, `v1_year_sponsors`.

Those views live in the CMS database. This process also reads `v1_talks` for year-scoped speaker tags. It does not query `v1_year_speakers`. Do not `SELECT` from `speakers`, `organizations`, `talks`, or other base tables. Never query Ash tables. The views are the API.

Year-scoped speaker rows include `languages` and `topics`. Year-scoped sponsor rows include `tier` (and `blurb`).

## Required HTTP routes

Wrap list payloads as `{ "data": [ ... ] }` unless noted. Unknown slugs and unknown paths return 404 `{ "error": "not_found" }`.

- `GET /health` — liveness (`{ "ok": true }`). The handler does not touch the database: no query and no new connection.
- `GET /` — identity (`language`, `language_version`, `api_version`, `framework`, `created_year`, `schema_version`, `endpoints`)
- `GET /v1/years`
- `GET /v1/speakers` and `GET /v1/speakers?year=2025`
- `GET /v1/speakers/{slug}` and `GET /v1/speakers/{year}/{slug}`
- `GET /v1/sponsors` and `GET /v1/sponsors?year=2025`
- `GET /v1/sponsors/{slug}` and `GET /v1/sponsors/{year}/{slug}`

`photo_path` and `logo_path` are web paths. Return the path. This process does not serve image bytes. There is no `images/` directory here.

## Register on boot (once)

`POST {CAROLINA_URL}/internal/api-endpoints/register`

```
Authorization: Bearer dev
Content-Type: application/json
```

The process sends `POLYGLOT_REGISTER_TOKEN`. The local example value is `dev`.

Body fields: `language`, `language_version`, `api_version`, `framework`, `created_year`, `base_url` (`PUBLIC_BASE_URL`), `schema_version` (1), `endpoints` (the `{ method, path, query }` objects this server already builds).

Do not heartbeat. Elixir keep-alives the currently warm API.

If `CAROLINA_URL` is unset, or the register token is unset, skip the call and still serve HTTP. If the POST fails (connection refused, timeout, 4xx/5xx), **log and keep serving**.

## What changed from the starter

- Node 25, TypeScript ESM (`"type": "module"`), framework `node:http` plus `pg`. There is no third-party HTTP framework.
- `npm test` drives the shipped handler through `setQueryFn` and does not need Postgres.
- The five quality gates are `npm test`, `npm run sast`, `npm run audit`, `gitleaks detect --source . --verbose`, and `npm run style`. `npm run hooks` installs pre-commit.
- The HTTP contract lives in the CMS OpenAPI. This repo has no `openapi.yaml`, `db/`, `images/`, or Compose catalog.
- The process listens dual-stack on IPv6 (`::`, `ipv6Only: false`) for Fly.
- CRaC does not apply to this Node service. Idle Fly machines suspend. See `DECISIONS.md`.
- Live catalog reads are Postgres 16 in the CMS, not the starter's Postgres 18 Compose database.
- `GET /health` returns `{ "ok": true }`.

Copy-paste commands, pins, and gotchas are in `MEMORY.md`. Why these choices won is in `DECISIONS.md`.

## Layout

| Path                        | Role                                                           |
| --------------------------- | -------------------------------------------------------------- |
| `src/server.ts`             | HTTP server, SQL, and one-shot registration                    |
| `test/`                     | `node:test` against the shipped handler and repo files         |
| `Dockerfile`                | `node:25` multi-stage image. Runtime is `node dist/server.js`. |
| `fly.toml`                  | Fly service. Suspends when idle. Does not enable CRaC.         |
| `package.json`, `mise.toml` | Node 25, npm scripts, gitleaks 8.30.1                          |
| `DECISIONS.md`              | Durable decisions (ADR fields)                                 |
| `MEMORY.md`                 | Commands, pins, gotchas                                        |

## Checklist

- The starter route set returns JSON (404 `{ "error": "not_found" }` on an unknown slug)
- `?year=` speaker rows include `languages` and `topics`; `?year=` sponsor rows include `tier`
- Register runs once at process start and no-ops when `CAROLINA_URL` is unset or the POST fails
- No writes. No Ash table names. No base-table reads
- `GET /health` does not touch the database
- Listen stays dual-stack on IPv6 for Fly
- A durable decision updates `DECISIONS.md`. A new command or gotcha updates `MEMORY.md`

## Cursor Cloud specific instructions

This repository is one sibling git remote in the carolina.codes polyglot fleet. Cloud agents should treat **this repo** as the workspace root. The Phoenix CMS is a different remote (`github.com/brightball/carolina-codes`). Do not assume `../elixir` or other sibling directories exist unless those remotes are attached to the same Cloud environment.

Postgres `v1_*` views live in the CMS database. Handler tests that use a fake catalog do not need Postgres. For live HTTP against the views, start Postgres 16 and set:

- `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/carolina_dev`
- `CAROLINA_URL=http://127.0.0.1:4000` (optional; registration no-ops if the CMS is down)
- `POLYGLOT_REGISTER_TOKEN=dev`
- `PUBLIC_BASE_URL` / `PORT` as in the README

Do not query Ash tables. Do not fold this tree into the CMS git remote. Contract: CMS `priv/api/openapi.yaml` + `priv/api/AGENTS.md`.
