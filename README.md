# carolina-codes-typescript

Read-only v1 polyglot API for Carolina Code Conference. Queries `v1_*` SQL views over `node:http` and `pg`.

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
