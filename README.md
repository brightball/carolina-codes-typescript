# carolina-codes-typescript

Read-only v1 polyglot API for Carolina Code Conference. Queries `v1_*` SQL views over `node:http` and `pg`.

## Versions

- Language: Node 25. Pinned in `mise.toml` (`node = "25"`), `package.json` `engines` (`>=25`), the `node:25-alpine` image, and the Gitea `node:25` workflow image.
- TypeScript: 5.9 (`typescript` `^5.9.2`). The package is ESM (`"type": "module"`).
- Framework: `node:http`, from the Node 25 standard library. There is no separate framework package and no framework version other than Node's.
- `pg` `^8.16.3` for PostgreSQL.
- `tsx` `^4.20.6` runs `npm run dev`. It is not in the production image.
- ESLint 9 (`eslint` `^9.39.5`) with `eslint-plugin-security` 3 (`^3.0.1`) and `typescript-eslint` `^8.70.0`.
- Prettier 3 (`prettier` `^3.9.6`).
- gitleaks 8.30.1, pinned in `mise.toml`.

CRaC does not apply to this Node service. Idle Fly machines suspend instead. That choice is recorded in `DECISIONS.md`. Commands and gotchas for agents are in `MEMORY.md`.

```
npm install
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/carolina_dev \
CAROLINA_URL=http://127.0.0.1:4000 \
POLYGLOT_REGISTER_TOKEN=dev \
PUBLIC_BASE_URL=http://127.0.0.1:4011 \
PORT=4011 \
npx tsx src/server.ts
```

Or compile with `npx tsc` and run `node dist/server.js`.

Quality gates (handler tests use the fake-catalog query hook and do not need Postgres):

```
npm test         # tsc --noEmit of shipped sources, then node:test against the shipped HTTP handler
npm run sast     # ESLint security plugin
npm run audit    # npm audit of the lockfile
gitleaks detect --source . --verbose
npm run style    # prettier --check
npm run hooks    # install local pre-commit hooks
```

Pre-commit runs the same five checks (`application tests`, `static security scanner`, `3rd-party dependency scanner`, `gitleaks`, `prettier`). Install once with `npm run hooks` (needs `pre-commit` on PATH; `mise install` provides Node 25 and gitleaks). Emergency skip: `SKIP=tests,sast,audit,gitleaks,style git commit`.
