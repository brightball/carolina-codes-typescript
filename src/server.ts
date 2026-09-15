import http from "node:http";
import { URL } from "node:url";
import { Pool } from "pg";

const LANGUAGE = "TypeScript";
const API_VERSION = "0.2.0";
const FRAMEWORK = "node:http";
const CREATED_YEAR = 2026;
const SCHEMA_VERSION = 1;
const LANGUAGE_VERSION = process.versions.node;

const ENDPOINTS = [
  { method: "GET", path: "/", query: [] as string[] },
  { method: "GET", path: "/health", query: [] as string[] },
  { method: "GET", path: "/v1/years", query: [] as string[] },
  { method: "GET", path: "/v1/speakers", query: ["year"] },
  { method: "GET", path: "/v1/speakers/:slug", query: [] as string[] },
  { method: "GET", path: "/v1/speakers/:year/:slug", query: [] as string[] },
  { method: "GET", path: "/v1/sponsors", query: ["year"] },
  { method: "GET", path: "/v1/sponsors/:slug", query: [] as string[] },
  { method: "GET", path: "/v1/sponsors/:year/:slug", query: [] as string[] },
];

const SPEAKER_COLS =
  "slug, first_name, last_name, name, tagline, bio, company, location, " +
  "photo_path, twitter_url, linkedin_url, website_url, github_url, featured";
const YEAR_SPONSOR_COLS =
  "slug, name, website, logo_path, description, blurb, tier, featured, year, " +
  "twitter_url, linkedin_url, youtube_url, instagram_url, facebook_url";
const SPONSOR_COLS =
  "slug, name, website, logo_path, description, twitter_url, linkedin_url, " +
  "youtube_url, instagram_url, facebook_url";
const TALK_COLS =
  "slug, title, description, format, youtube_id, year, speaker_slug, languages, topics";

export type Json = Record<string, unknown>;
export type QueryFn = (sql: string, params: unknown[]) => Promise<Json[]> | Json[];
export type ConnectFn = () => Pool;

export let sqlCount = 0;
export let connectCount = 0;
export let queryFn: QueryFn | null = null;
export let connectFn: ConnectFn | null = null;

let pool: Pool | undefined;

export function listenHost(): string {
  return "::";
}

export function resetCounts(): void {
  sqlCount = 0;
  connectCount = 0;
}

export function setSqlCount(n: number): void {
  sqlCount = n;
}

export function setConnectCount(n: number): void {
  connectCount = n;
}

export function setQueryFn(fn: QueryFn | null): void {
  queryFn = fn;
}

export function setConnectFn(fn: ConnectFn | null): void {
  connectFn = fn;
}

export function dsn(): string {
  let raw = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/carolina_dev";
  if (!raw.includes("sslmode=")) {
    raw += (raw.includes("?") ? "&" : "?") + "sslmode=disable";
  }
  return raw;
}

export function openPool(): Pool {
  connectCount += 1;
  if (connectFn) return connectFn();
  return new Pool({ connectionString: dsn() });
}

export function ensurePool(): Pool {
  if (!pool) pool = openPool();
  return pool;
}

export async function dbQuery(sql: string, params: unknown[] = []): Promise<Json[]> {
  sqlCount += 1;
  if (queryFn) return queryFn(sql, params);
  const result = await ensurePool().query(sql, params);
  return result.rows as Json[];
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const stripped = value.trim();
    if (!stripped || stripped === "{}") return [];
    const inner =
      stripped.startsWith("{") && stripped.endsWith("}") ? stripped.slice(1, -1) : stripped;
    return inner
      .split(",")
      .map((part) => part.replace(/^"|"$/g, "").trim())
      .filter((part) => part.length > 0);
  }
  return [];
}

function clean(row: Json | null | undefined): Json | null {
  if (!row) return null;
  const out: Json = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (key === "languages" || key === "topics") {
      out[key] = asStringArray(value);
    } else if (key === "featured") {
      out[key] = Boolean(value);
    } else if (key === "year" && value != null) {
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function uniqTags(talks: Json[], key: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const talk of talks) {
    for (const val of asStringArray(talk[key])) {
      if (!seen.has(val)) {
        seen.add(val);
        out.push(val);
      }
    }
  }
  return out;
}

async function talksFor(slug: string, year?: number): Promise<Json[]> {
  const params: unknown[] = [slug];
  let sql = `SELECT ${TALK_COLS} FROM v1_talks WHERE speaker_slug = $1`;
  if (year != null) {
    sql += " AND year = $2";
    params.push(year);
  }
  sql += " ORDER BY year DESC";
  const rows = await dbQuery(sql, params);
  return rows.map((row) => clean(row) as Json);
}

async function talkYears(slug: string): Promise<number[]> {
  const rows = await dbQuery(
    "SELECT DISTINCT year FROM v1_talks WHERE speaker_slug = $1 ORDER BY year DESC",
    [slug],
  );
  return rows.map((row) => Number(row.year));
}

async function sponsorYears(slug: string): Promise<number[]> {
  const rows = await dbQuery(
    "SELECT DISTINCT year FROM v1_sponsorships WHERE sponsor_slug = $1 ORDER BY year DESC",
    [slug],
  );
  return rows.map((row) => Number(row.year));
}

async function loadSpeaker(slug: string): Promise<Json | null> {
  const rows = await dbQuery(`SELECT ${SPEAKER_COLS} FROM v1_speakers WHERE slug = $1`, [slug]);
  return clean(rows[0]);
}

export async function listSpeakers(year?: number): Promise<Json[]> {
  if (year == null) {
    const rows = await dbQuery(
      `SELECT ${SPEAKER_COLS} FROM v1_speakers ORDER BY last_name, first_name`,
    );
    return rows.map((row) => clean(row) as Json);
  }
  const rows = await dbQuery(
    `SELECT ${SPEAKER_COLS} FROM v1_speakers ` +
      "WHERE slug IN (SELECT speaker_slug FROM v1_talks WHERE year = $1) " +
      "ORDER BY last_name, first_name",
    [year],
  );
  return attachYearTags(
    rows.map((row) => clean(row) as Json),
    year,
  );
}

async function attachYearTags(speakers: Json[], year: number): Promise<Json[]> {
  if (speakers.length === 0) return speakers;
  const slugs = speakers.map((speaker) => String(speaker.slug));
  const talksBy = await loadTalksForYear(year);
  const yearsBy = await loadYearsForSlugs(slugs);
  for (const speaker of speakers) {
    const slug = String(speaker.slug);
    const talks = talksBy.get(slug) ?? [];
    const years = yearsBy.get(slug) ?? [];
    speaker.year = year;
    speaker.talks = talks;
    speaker.languages = uniqTags(talks, "languages");
    speaker.topics = uniqTags(talks, "topics");
    speaker.years = years;
  }
  return speakers;
}

async function loadTalksForYear(year: number): Promise<Map<string, Json[]>> {
  const rows = await dbQuery(
    `SELECT ${TALK_COLS} FROM v1_talks WHERE year = $1 ORDER BY speaker_slug, year DESC`,
    [year],
  );
  const out = new Map<string, Json[]>();
  for (const row of rows) {
    const talk = clean(row) as Json;
    const slug = String(talk.speaker_slug ?? "");
    const list = out.get(slug) ?? [];
    list.push(talk);
    out.set(slug, list);
  }
  return out;
}

async function loadYearsForSlugs(slugs: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (slugs.length === 0) return out;
  const rows = await dbQuery(
    "SELECT DISTINCT speaker_slug, year FROM v1_talks WHERE speaker_slug = ANY($1::text[]) ORDER BY speaker_slug, year DESC",
    [slugs],
  );
  for (const row of rows) {
    const slug = String(row.speaker_slug);
    const list = out.get(slug) ?? [];
    list.push(Number(row.year));
    out.set(slug, list);
  }
  return out;
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  const bytes = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Polyglot-Language": LANGUAGE,
    "X-Polyglot-Framework": FRAMEWORK,
    "Content-Length": bytes.length,
  });
  res.end(bytes);
}

export async function route(
  path: string,
  parts: string[],
  yearParam: string | null,
): Promise<{ status: number; payload: unknown }> {
  if (path === "/") {
    return {
      status: 200,
      payload: {
        language: LANGUAGE,
        language_version: LANGUAGE_VERSION,
        api_version: API_VERSION,
        framework: FRAMEWORK,
        created_year: CREATED_YEAR,
        schema_version: SCHEMA_VERSION,
        endpoints: ENDPOINTS,
      },
    };
  }
  if (path === "/health") {
    return { status: 200, payload: { ok: true } };
  }
  if (path === "/v1/years") {
    const rows = await dbQuery("SELECT year, slug, name, status FROM v1_years ORDER BY year DESC");
    return {
      status: 200,
      payload: { data: rows.map((row) => clean(row)) },
    };
  }
  if (path === "/v1/speakers") {
    const year = yearParam ? Number(yearParam) : undefined;
    return { status: 200, payload: { data: await listSpeakers(year) } };
  }
  if (
    parts.length === 4 &&
    parts[0] === "v1" &&
    parts[1] === "speakers" &&
    /^\d+$/.test(parts[2])
  ) {
    const year = Number(parts[2]);
    const slug = parts[3];
    const speaker = await loadSpeaker(slug);
    if (!speaker) return { status: 404, payload: { error: "not_found" } };
    const talks = await talksFor(slug, year);
    if (talks.length === 0) {
      return { status: 404, payload: { error: "not_found" } };
    }
    const years = await talkYears(slug);
    speaker.year = year;
    speaker.years = years;
    speaker.other_years = years.filter((n) => n !== year);
    speaker.talks = talks;
    speaker.languages = uniqTags(talks, "languages");
    speaker.topics = uniqTags(talks, "topics");
    return { status: 200, payload: { data: speaker } };
  }
  if (parts.length === 3 && parts[0] === "v1" && parts[1] === "speakers") {
    const slug = parts[2];
    const speaker = await loadSpeaker(slug);
    if (!speaker) return { status: 404, payload: { error: "not_found" } };
    speaker.talks = await talksFor(slug);
    speaker.years = await talkYears(slug);
    return { status: 200, payload: { data: speaker } };
  }
  if (path === "/v1/sponsors") {
    if (yearParam) {
      const rows = await dbQuery(
        `SELECT ${YEAR_SPONSOR_COLS} FROM v1_year_sponsors WHERE year = $1 ORDER BY name`,
        [Number(yearParam)],
      );
      return {
        status: 200,
        payload: { data: rows.map((row) => clean(row)) },
      };
    }
    const rows = await dbQuery(`SELECT ${SPONSOR_COLS} FROM v1_sponsors ORDER BY name`);
    return {
      status: 200,
      payload: { data: rows.map((row) => clean(row)) },
    };
  }
  if (
    parts.length === 4 &&
    parts[0] === "v1" &&
    parts[1] === "sponsors" &&
    /^\d+$/.test(parts[2])
  ) {
    const year = Number(parts[2]);
    const slug = parts[3];
    const rows = await dbQuery(
      `SELECT ${YEAR_SPONSOR_COLS} FROM v1_year_sponsors WHERE year = $1 AND slug = $2`,
      [year, slug],
    );
    const row = clean(rows[0]);
    if (!row) return { status: 404, payload: { error: "not_found" } };
    const years = await sponsorYears(slug);
    row.years = years;
    row.other_years = years.filter((n) => n !== year);
    return { status: 200, payload: { data: row } };
  }
  if (parts.length === 3 && parts[0] === "v1" && parts[1] === "sponsors") {
    const slug = parts[2];
    const rows = await dbQuery(`SELECT ${SPONSOR_COLS} FROM v1_sponsors WHERE slug = $1`, [slug]);
    const row = clean(rows[0]);
    if (!row) return { status: 404, payload: { error: "not_found" } };
    const sponsorships = await dbQuery("SELECT * FROM v1_sponsorships WHERE sponsor_slug = $1", [
      slug,
    ]);
    row.sponsorships = sponsorships.map((item) => clean(item));
    return { status: 200, payload: { data: row } };
  }
  return { status: 404, payload: { error: "not_found" } };
}

async function register(port: string): Promise<void> {
  const url = process.env.CAROLINA_URL;
  const token = process.env.POLYGLOT_REGISTER_TOKEN;
  if (!url || !token) return;
  const base = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;
  try {
    const resp = await fetch(`${url.replace(/\/$/, "")}/internal/api-endpoints/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language: LANGUAGE,
        language_version: LANGUAGE_VERSION,
        api_version: API_VERSION,
        framework: FRAMEWORK,
        created_year: CREATED_YEAR,
        schema_version: SCHEMA_VERSION,
        base_url: base,
        endpoints: ENDPOINTS,
      }),
      signal: AbortSignal.timeout(5000),
    });
    console.error(`registered with elixir: ${resp.status}`);
  } catch (err) {
    console.error(`register: ${err}`);
  }
}

export function startServer(): http.Server {
  ensurePool();
  const port = process.env.PORT ?? "4011";
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const parts = path.split("/").filter(Boolean);
      const yearParam = url.searchParams.get("year");
      const { status, payload } = await route(path, parts, yearParam);
      send(res, status, payload);
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  void register(port);
  server.listen({ port: Number(port), host: listenHost(), ipv6Only: false }, () => {
    console.error(
      `carolina-codes-typescript listening on :${port} ${JSON.stringify(server.address())}`,
    );
  });

  function shutdown(): void {
    server.close(() => {
      void (pool ? pool.end() : Promise.resolve()).then(() => process.exit(0));
    });
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return server;
}

if (/(^|[\\/])server\.(ts|js)$/.test(process.argv[1] ?? "")) {
  startServer();
}
