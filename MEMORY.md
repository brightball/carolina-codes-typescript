# Agent memory

Operational notes for this repository: commands, pinned versions, and gotchas. Why a choice was made is in `DECISIONS.md`. Read both files before an architectural edit.

Add a command, a pin, or a gotcha here when you learn one that the next session would otherwise rediscover. Do not restate an ADR. Do not put tokens, production DSNs, or non-public hostnames in this file. Local examples stay the public placeholders below (`postgres://postgres:postgres@127.0.0.1`, register token `dev`, localhost URLs).

## Commands

Install and run against a local CMS database (Postgres 16). Handler tests do not need this.

```
npm install
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/carolina_dev \
CAROLINA_URL=http://127.0.0.1:4000 \
POLYGLOT_REGISTER_TOKEN=dev \
PUBLIC_BASE_URL=http://127.0.0.1:4011 \
PORT=4011 \
npx tsx src/server.ts
```

`npm run dev` is the same `tsx` entry. Production shape: `npx tsc`, then `node dist/server.js`.

Quality gates, in the same order as pre-commit:

```
npm test
npm run sast
npm run audit
gitleaks detect --source . --verbose
npm run style
npm run hooks
```

`npm test` runs `tsc --noEmit` for `src/` and for `test/`, then `node --test --test-concurrency=1 test/*.test.ts`. `npm run hooks` installs the pre-commit hooks and sets `core.hooksPath` to `.githooks`. `mise install` provides Node 25 and gitleaks. Emergency skip: `SKIP=tests,sast,audit,gitleaks,style git commit`.

Format the tree with `npm run format` (Prettier write). The gate is `npm run style` (Prettier check).

## Pins

| Piece               | Pin                                                              |
| ------------------- | ---------------------------------------------------------------- |
| Node                | 25 (`mise.toml`, `engines.node` `>=25`, image `node:25`)         |
| TypeScript          | 5.9 (`typescript` `^5.9.2`), ESM                                 |
| HTTP framework      | `node:http` in the Node 25 standard library. No package version. |
| `pg`                | `^8.16.3`                                                        |
| `tsx`               | `^4.20.6` (dev only)                                             |
| ESLint              | 9 (`eslint` `^9.39.5`) with `eslint-plugin-security` `^3.0.1`    |
| `typescript-eslint` | `^8.70.0`                                                        |
| Prettier            | 3 (`prettier` `^3.9.6`), `printWidth` 100                        |
| gitleaks            | 8.30.1 (`mise.toml` and the Gitea prep job)                      |
| `@types/node`       | `^24.10.1` while `engines` requires Node 25                      |
| `@types/pg`         | `^8.15.6`                                                        |

CRaC does not apply to this Node service. Do not add a CRaC pin.

## Gotchas

- `GET /health` returns `{ "ok": true }`. The starter text said `{ "status": "ok" }`. Do not change the shipped body to match that wording. The handler must not query and must not open a connection. Tests assert `sqlCount` and `connectCount`.
- Default `PORT` in code is `4011`. The Dockerfile and `fly.toml` set `8080`.
- Listen with `listenHost()` (`::`) and `ipv6Only: false` so the socket is dual-stack IPv6. Binding only `127.0.0.1` or only IPv4 breaks the Fly proxy. `server.keepAliveTimeout` is 65 seconds because that proxy reuses upstream sockets past Node's 5 second default. `headersTimeout` is 70 seconds.
- `dsn()` appends `sslmode=disable` when the URL has no `sslmode`. Leave that in place for the local CMS database.
- The pool is created at boot (`max` 4, `allowExitOnIdle`). Catalog routes share it. Year-scoped speaker listing must stay a bounded query (talks for the year, then years for the slug list), not one query per speaker. The handler test fails a per-speaker query loop.
- Fake-catalog tests match SQL by view name (`FROM v1_speakers`, `FROM v1_talks`, and the other views in `DECISIONS.md` D2). If you change a statement's text, update `test/handler.test.ts` in the same change.
- Registration runs once from `startServer`. It is skipped when `CAROLINA_URL` or `POLYGLOT_REGISTER_TOKEN` is unset. A failed POST is logged. The process keeps serving. There is no heartbeat. The JSON `endpoints` field is the server's `{ method, path, query }` objects, not a list of `"GET /path"` strings.
- Node runs `test/*.test.ts` directly. Do not add a second test runner. New tests go in `test/` so `npm test` picks them up. The docs test only reads Markdown. It does not import `src/server.ts`.
- The runtime image is `node:25-alpine`, `npm ci --omit=dev`, user `node`, command `node dist/server.js`. `tsx`, TypeScript, and ESLint stay out of that stage. The Gitea workflow uses `node:25-bookworm` for the gates.
- Gitea prep clones the SHA with the job token, runs `npm ci` once, and unpacks gitleaks 8.30.1. The five check jobs download that artifact (`actions/upload-artifact` v3). They must not clone, must not `npm ci`, and must not download gitleaks again. Do not switch the workflow to `actions/checkout`. Do not `git init` in it.
- This repo has no `openapi.yaml`, `db/`, `images/`, or Compose catalog. Do not add them. Live views are Postgres 16 in the CMS. Do not point docs back at the starter's Postgres 18 Compose file.
- `@types/node` is on the 24 line. Do not bump it to match the number 25, and do not lower `engines` to 24, without a decision. The runtime pin is Node 25.
- `security/detect-object-injection` is off in `eslint.config.js`. Other `eslint-plugin-security` recommended rules stay on. `npm run sast` uses `--max-warnings 0`.
- Do not fold this tree into the CMS git remote. Do not assume a sibling checkout such as `../elixir` exists.
