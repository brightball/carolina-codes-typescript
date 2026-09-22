import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as app from "./src/server.ts";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;

function expect(cond: unknown, msg: string): void {
  if (cond) {
    console.error(`ok: ${msg}`);
  } else {
    console.error(`FAIL: ${msg}`);
    failed += 1;
  }
}

function assertYearsDesc(speakers: app.Json[], label: string): void {
  let foundMulti = false;
  for (const sp of speakers) {
    const years = Array.isArray(sp.years) ? (sp.years as number[]) : [];
    if (years.length < 2) continue;
    foundMulti = true;
    for (let i = 1; i < years.length; i++) {
      if (Number(years[i - 1]) < Number(years[i])) {
        expect(false, `${label} years not DESC for ${sp.slug}: ${years.join(",")}`);
        return;
      }
    }
  }
  expect(foundMulti, `${label} expected a speaker with >=2 years`);
}

const src = readFileSync(join(here, "src/server.ts"), "utf8");

expect(app.listenHost() === "::", "listen host is ::");
expect(!src.includes('"0.0.0.0"'), "source does not bind 0.0.0.0");
expect(src.includes("listenHost()"), "server uses listenHost()");
expect(src.includes("ipv6Only: false"), "listen is dual-stack (ipv6Only: false)");
expect(src.includes("sslmode=disable"), "DSN keeps sslmode=disable");
expect(app.dsn().includes("sslmode=disable"), "dsn() includes sslmode=disable");

const reg = src.indexOf("async function register(");
expect(reg >= 0, "register exists");
if (reg >= 0) {
  const fn = src.slice(reg, src.indexOf("export function startServer"));
  expect(!fn.includes("openPool("), "register-once does not open the pool");
  expect(!fn.includes("ensurePool("), "register-once does not open Postgres");
  expect(!fn.includes("dbQuery("), "register-once does not run catalog SQL");
  expect(!fn.includes("new Pool"), "register-once does not construct pg.Pool");
}

app.resetCounts();
const health = await app.route("/health", ["health"], null);
expect(health.status === 200, "/health returns 200");
expect((health.payload as { ok?: boolean }).ok === true, "/health body is ok JSON");
expect(app.sqlCount === 0, "/health does not run SQL");
expect(app.connectCount === 0, "/health does not open Postgres");

let live = true;
try {
  app.ensurePool();
} catch (err) {
  live = false;
  console.error(`postgres unavailable, using query hook: ${err}`);
  app.setConnectFn(() => {
    throw new Error("fake connect");
  });
  app.setQueryFn((sql) => {
    if (sql.includes("FROM v1_speakers")) {
      return [0, 1, 2].map((i) => ({ slug: `s${i}`, first_name: "A", last_name: "B" }));
    }
    if (sql.includes("ANY(")) {
      return [
        { speaker_slug: "s0", year: 2026 },
        { speaker_slug: "s0", year: 2024 },
      ];
    }
    if (sql.includes("FROM v1_talks")) {
      return [
        {
          slug: "t0",
          title: "Talk",
          speaker_slug: "s0",
          year: 2026,
          languages: ["typescript"],
          topics: [],
        },
      ];
    }
    return [];
  });
  app.setConnectCount(1);
}

const boot = app.connectCount;
app.setSqlCount(0);

const listing = await app.route("/v1/speakers", ["v1", "speakers"], "2026");
const payload = listing.payload as { data?: app.Json[] };
const speakers = Array.isArray(payload.data) ? payload.data : [];
const n = speakers.length;
const sql = app.sqlCount;
console.error(
  `year list status=${listing.status} sql=${sql} speakers=${n} connects=${app.connectCount}`,
);

if (live && listing.status !== 200) {
  expect(false, `live year listing status ${listing.status}`);
}

if (listing.status === 200) {
  expect(n >= 3, "year listing returns N>=3 speakers");
  expect(sql > 0, "listing runs SQL through shipped query wrapper");
  expect(sql < 2 * n, "SQL count does not grow as ~2N");
  expect(sql <= 4, "year listing SQL is bounded (speakers + talks + years)");
  assertYearsDesc(speakers, "handler");
  expect(app.connectCount === boot, "listing reuses the boot pool");

  const rows = await app.listSpeakers(2026);
  assertYearsDesc(rows, "listSpeakers");

  app.setSqlCount(0);
  const listing2 = await app.route("/v1/speakers", ["v1", "speakers"], "2026");
  expect(listing2.status === 200, "second catalog request succeeds");
  expect(app.connectCount === boot, "second catalog request reuses pool (no extra connect)");
} else {
  expect(sql < 2 * 3, "failed listing did not run per-row SQL for N=3");
}

process.env.PORT = "0";
delete process.env.CAROLINA_URL;
delete process.env.POLYGLOT_REGISTER_TOKEN;
const bound = app.startServer();
await once(bound, "listening");
const info = bound.address() as AddressInfo;
expect(info.family === "IPv6", `bound family is IPv6, got ${info.family}`);
const boundPort = info.port;
const v4 = await fetch(`http://127.0.0.1:${boundPort}/health`);
const v4Body = await v4.text();
const v6 = await fetch(`http://[::1]:${boundPort}/health`);
const v6Body = await v6.text();
expect(
  v4.ok && v4Body.includes('"ok":true'),
  `in-process 127.0.0.1 /health ${v4.status} ${v4Body}`,
);
expect(v6.ok && v6Body.includes('"ok":true'), `in-process [::1] /health ${v6.status} ${v6Body}`);
await new Promise<void>((resolve, reject) => {
  bound.close((err) => (err ? reject(err) : resolve()));
});

if (failed) {
  console.error("perf_test failed");
  process.exit(1);
}
console.error("perf_test passed");
process.exit(0);
