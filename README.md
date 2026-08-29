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
