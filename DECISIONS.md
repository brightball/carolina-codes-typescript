# Decisions

Durable architectural decisions for this TypeScript API. Each entry is a Nygard-style architecture decision record: status, context, decision, and consequences, plus the alternatives that were rejected.

Recorded 2026-10-07 from behavior already implemented on `main`. This is the initial log, not a contemporaneous transcript. Git history is the changelog. Do not add amendment diaries inside an entry. When a later entry replaces one, set the old status to `superseded` and name the new id. Append only.

Agents read this file before an architectural edit. An `accepted` entry is binding. A task that conflicts with one stops until this file changes in the same edit. Commands, version pins, and environment gotchas belong in `MEMORY.md`, not here.

## D1. HTTP server is node:http

- Status: accepted

### Context

The starter requires a small read-only JSON route set, one registration POST on boot, and a `GET /health` that does not touch the database. The Fly machine is 256 MB. A third-party HTTP framework would add a dependency and a version that this route set does not need.

### Decision

Serve HTTP with the Node standard library `node:http`. Use `pg` for SQL. The identity payload reports `framework` as `node:http`. Do not add Express, Fastify, Hono, or another HTTP framework.

### Consequences

Routing, status codes, and response headers live in `src/server.ts`. There is no framework middleware chain. The outbound register call uses global `fetch`, not the inbound server. The framework version is the Node version. There is no separate framework package to pin.

### Alternatives

Express, Fastify, and Hono were rejected. They fit larger applications and would put a second version in the image for a fixed set of GET routes.

## D2. Query PostgreSQL v1_* views only

- Status: accepted

### Context

The Phoenix CMS owns the catalog. Ash resource tables are its internal storage. Polyglot siblings share one contract: ordinary JSON read from PostgreSQL `v1_*` views. The starter forbids Ash JSON:API and forbids using base tables as the public contract.

### Decision

Read only `v1_speakers`, `v1_sponsors`, `v1_years`, `v1_talks`, `v1_sponsorships`, and `v1_year_sponsors`. Never query Ash tables. Do not `SELECT` from base tables such as `speakers`, `organizations`, or `talks`. This server does not query `v1_year_speakers`. Year-scoped speakers come from `v1_speakers` filtered by `v1_talks`.

### Consequences

A column the view does not expose cannot be added here. View definitions ship with the CMS. This repo has no `db/` scripts. Writes are out of scope.

### Alternatives

Querying Ash tables, or copying the catalog schema into this repo, was rejected. Either choice would drift from the CMS and from the other language APIs.

## D3. Handler tests use a fake catalog through setQueryFn

- Status: accepted

### Context

`npm test` has to pass in pre-commit and in Gitea without a database. The `v1_*` views live in the CMS. This repo does not vendor the starter catalog, so a Compose Postgres would not be the database the process is written against.

### Decision

`npm test` typechecks the shipped sources, then runs `node:test` against the shipped handler. Tests install a fake catalog with `setQueryFn` and, where a pool must not open, `setConnectFn`. They do not need Postgres. `GET /health` tests assert that the handler does not query and does not connect.

### Consequences

A change to SQL text must update the fake catalog in `test/handler.test.ts`, which matches on the view names in the statement. Live HTTP against Postgres 16 is a manual check. The default gate does not start a database.

### Alternatives

Testcontainers, or the starter's Postgres 18 Compose catalog, were rejected. The catalog is not in this tree, and the pre-commit gate has to run from npm alone.

## D4. Idle Fly machines suspend; CRaC does not apply

- Status: accepted

### Context

JVM siblings can use CRaC to snapshot a warm process. This service is Node. Fly can suspend a machine whose memory stays at or under 2 GB. This app's machine is 256 MB. `GET /health` is the proxy check and must stay cheap.

### Decision

`fly.toml` sets `auto_stop_machines = "suspend"` and `min_machines_running = 0`. CRaC does not apply to this Node service. Do not add CRaC, a JVM, or a checkpoint runtime.

### Consequences

After idle, Fly resumes a memory snapshot instead of booting a new machine. The health check stays a database-free `GET /health`. Swap is not configured. Resume still depends on the process listening where Fly's proxy connects (see the dual-stack listen note in `MEMORY.md`).

### Alternatives

`auto_stop_machines = "stop"` was rejected because every resume would be a cold boot. Leaving a machine always running was rejected because the service can idle. CRaC was rejected because it is a JVM feature and this process is Node.

## D5. Five quality gates

- Status: accepted

### Context

Each polyglot sibling blocks a commit on the same five kinds of check: application tests, a static security scanner, a dependency audit, a secret scan, and a formatter. The names need to stay recognizable across languages.

### Decision

The gates are `npm test`, `npm run sast` (ESLint with `eslint-plugin-security`), `npm run audit`, `gitleaks detect --source . --verbose`, and `npm run style` (Prettier). `npm run hooks` installs those hooks locally. Gitea runs one job per gate after a single prep job.

### Consequences

A change that fails any gate does not commit. The emergency skip is `SKIP=tests,sast,audit,gitleaks,style`. Adding or renaming a gate means updating `package.json`, `.pre-commit-config.yaml`, `.githooks/pre-commit`, `.gitea/workflows/precommit.yml`, and this entry together.

### Alternatives

One combined CI script was rejected so a failure names the gate. A different hook runner that would rename the five checks was rejected so the fleet stays aligned.

## D6. TypeScript ESM, compiled JavaScript in production

- Status: accepted

### Context

The API is authored in TypeScript. The production image should contain production dependencies and the compiled program, not the compiler or the dev runner.

### Decision

`package.json` sets `"type": "module"`. `tsc` writes `dist/server.js`. The runtime image runs `node dist/server.js` as the `node` user. `tsx` is a devDependency for `npm run dev` only.

### Consequences

Tests import `../src/server.ts`. Node runs those tests with type stripping. Do not add a CommonJS build. Do not copy `tsx`, `typescript`, or ESLint into the runtime image. `npm test` typechecks `src/` and `test/` before the tests run.

### Alternatives

Running `tsx` in production was rejected because it pulls the compiler toolchain into the image. Compiling to CommonJS was rejected because the package and the tests are ESM.

## D7. HTTP contract stays in the CMS

- Status: accepted

### Context

The starter repository vendors `openapi.yaml`, `db/*.sql`, `images/`, and a Postgres 18 Compose file so a fork can boot with no CMS. This repository is a finished sibling. The CMS already publishes the contract and hosts the real `v1_*` views on Postgres 16.

### Decision

Do not vendor `openapi.yaml`, `db/`, `images/`, or `docker-compose.yml` in this tree. The HTTP contract is the CMS OpenAPI (`priv/api/openapi.yaml` and `priv/api/AGENTS.md`). Live reads use the CMS database.

### Consequences

Agents must not recreate the starter layout here. Photo and logo fields stay web paths. This process does not serve those bytes. A contract change is a CMS change, then a matching handler change if the JSON shape moves.

### Alternatives

Copying the starter catalog into this repo was rejected. The seed would diverge from the CMS, and local docs would describe a database this process is not deployed against.
